import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// 公開済みの動画に、チャンネル本人として案内コメントを投稿する(固定は運営者がStudioで手動で行う)。
// 予約中(非公開)の動画にはコメントできないため、公開後の動画だけが対象。
// 過去動画への一括投稿は、同一文面の大量投稿がスパム判定されるのを避けるため1回あたりの件数を絞る。
// 公開から48時間以内の新しい動画は、この上限に関係なく必ず投稿する。
const BACKLOG_PER_RUN = 5;
const NEW_VIDEO_HOURS = 48;
const MARKER = "Xや他のチャンネルもやっているので";

const BASE_TEXT = `Xや他のチャンネルもやっているので、ぜひ覗いてみてね！

【X（Twitter）】
https://x.com/tac_fxtrade?s=21

【メインチャンネル】
https://www.youtube.com/channel/UCpmL0HqTr-rqJSoSa6trPoQ

【エンタメ系チャンネル】
https://www.youtube.com/channel/UCiPr3RQd39CFUV1NXZMtWLA`;
const CLOSING = "概要欄からクリックしてみてください！";

// 概要欄に関連するメインチャンネル動画の誘導(write-description.mjsが入れる)があれば、コメントにも同じ動画を入れる
const RELATED_RE = /▼この動画に関連する解説はメインチャンネルで！\n(.+)\n(https:\/\/www\.youtube\.com\/watch\?v=[\w-]+)/;
function commentTextFor(video) {
  const m = video.snippet.description?.match(RELATED_RE);
  const related = m ? `\n\n【この動画に関連するメインチャンネルの解説】\n${m[1]}\n${m[2]}` : "";
  return `${BASE_TEXT}${related}\n\n${CLOSING}`;
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8")));
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const ch = await youtube.channels.list({ part: ["contentDetails"], mine: true });
const channelId = ch.data.items[0].id;
const uploadsId = ch.data.items[0].contentDetails.relatedPlaylists.uploads;

const ids = [];
let pageToken;
do {
  const r = await youtube.playlistItems.list({ part: ["contentDetails"], playlistId: uploadsId, maxResults: 50, pageToken });
  ids.push(...r.data.items.map((i) => i.contentDetails.videoId));
  pageToken = r.data.nextPageToken;
} while (pageToken);

const videos = [];
for (let i = 0; i < ids.length; i += 50) {
  const r = await youtube.videos.list({ part: ["status", "snippet"], id: ids.slice(i, i + 50) });
  videos.push(...r.data.items);
}
const publicVideos = videos
  .filter((v) => v.status.privacyStatus === "public")
  .sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));

async function findOwnComment(videoId) {
  let token;
  do {
    const r = await youtube.commentThreads.list({ part: ["snippet"], videoId, maxResults: 100, pageToken: token });
    for (const t of r.data.items ?? []) {
      const c = t.snippet.topLevelComment;
      if (c.snippet.authorChannelId?.value === channelId && c.snippet.textOriginal?.includes(MARKER)) return c;
    }
    token = r.data.nextPageToken;
  } while (token);
  return null;
}

const now = Date.now();
let posted = 0;
let updated = 0;
let backlogPosted = 0;
let remaining = 0;
for (const v of publicVideos) {
  const text = commentTextFor(v);
  const existing = await findOwnComment(v.id);
  if (existing) {
    // 概要欄に後から関連動画の誘導が入った場合など、コメントの内容が古ければ書き換える(固定は維持される)
    if (existing.snippet.textOriginal !== text) {
      await youtube.comments.update({ part: ["snippet"], requestBody: { id: existing.id, snippet: { textOriginal: text } } });
      updated++;
      console.log(`更新: ${v.id} ${v.snippet.title}`);
    }
    continue;
  }
  const isNew = now - new Date(v.snippet.publishedAt).getTime() < NEW_VIDEO_HOURS * 3600 * 1000;
  if (!isNew && backlogPosted >= BACKLOG_PER_RUN) {
    remaining++;
    continue;
  }
  await youtube.commentThreads.insert({
    part: ["snippet"],
    requestBody: {
      snippet: { channelId, videoId: v.id, topLevelComment: { snippet: { textOriginal: text } } },
    },
  });
  posted++;
  if (!isNew) backlogPosted++;
  console.log(`投稿: ${v.id} ${v.snippet.title}`);
}
console.log(`完了: 今回${posted}件投稿・${updated}件更新 / 未投稿の残り${remaining}件(公開中${publicVideos.length}本)`);
