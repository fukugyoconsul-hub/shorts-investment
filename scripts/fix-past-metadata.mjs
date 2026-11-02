import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { assertCorrectChannel } from "./verify-channel.mjs";
import { fixHashtagLine } from "./hashtags.mjs";

// 投稿済みの動画のカテゴリ・言語・無関係なハッシュタグを直す(タイトルとタグは変えない)。
// APIの上限があるので1回の件数を絞り、監視ワークフローから少しずつ進める。直し終わると何もしなくなる。
// 使い方: node fix-past-metadata.mjs [--dry]
const MAX_PER_RUN = 10; // 監視ワークフローは1日4回動くので、1日40本ずつ進む
const DRY = process.argv.includes("--dry");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8")));
const youtube = google.youtube({ version: "v3", auth: oauth2Client });
await assertCorrectChannel(youtube);

const categoryById = new Map(
  JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8"))
    .filter((t) => t.videoId)
    .map((t) => [t.videoId, t.category])
);

const ch = await youtube.channels.list({ part: ["contentDetails"], mine: true });
const ids = [];
let pageToken;
do {
  const r = await youtube.playlistItems.list({
    part: ["contentDetails"],
    playlistId: ch.data.items[0].contentDetails.relatedPlaylists.uploads,
    maxResults: 50,
    pageToken,
  });
  ids.push(...r.data.items.map((i) => i.contentDetails.videoId));
  pageToken = r.data.nextPageToken;
} while (pageToken);

const pending = [];
for (let i = 0; i < ids.length; i += 50) {
  const r = await youtube.videos.list({ part: ["snippet"], id: ids.slice(i, i + 50) });
  for (const v of r.data.items) {
    const s = v.snippet;
    const description = fixHashtagLine(s.description, categoryById.get(v.id), s.title);
    if (s.categoryId !== "27" || s.defaultLanguage !== "ja" || s.defaultAudioLanguage !== "ja" || description !== s.description) {
      pending.push({ id: v.id, snippet: s, description });
    }
  }
}

const isQuotaError = (err) => err?.errors?.some((e) => e.reason === "quotaExceeded") || /quota/i.test(err?.message ?? "");
let done = 0;
for (const { id, snippet: s, description } of pending.slice(0, MAX_PER_RUN)) {
  const before = s.description.trim().split("\n").pop();
  const after = description.trim().split("\n").pop();
  console.log(`${DRY ? "予定" : "修正"}: ${id} ${s.title}\n  カテゴリ ${s.categoryId}→27 / 音声 ${s.defaultAudioLanguage ?? "なし"}→ja\n  ${before}\n  → ${after}`);
  if (DRY) continue;
  try {
    await youtube.videos.update({
      part: ["snippet"],
      requestBody: {
        id,
        snippet: { title: s.title, description, tags: s.tags, categoryId: "27", defaultLanguage: "ja", defaultAudioLanguage: "ja" },
      },
    });
    done++;
  } catch (err) {
    if (isQuotaError(err)) {
      console.log("YouTube APIの1日の上限に達したため、残りは次回に回します");
      break;
    }
    throw err;
  }
}
console.log(`完了: 今回${done}本 / 未修正の残り${pending.length - done}本(全${ids.length}本)`);
