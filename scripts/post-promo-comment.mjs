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

const COMMENT_TEXT = `Xや他のチャンネルもやっているので、ぜひ覗いてみてね！

【X（Twitter）】
https://x.com/tac_fxtrade?s=21

【メインチャンネル】
https://www.youtube.com/channel/UCpmL0HqTr-rqJSoSa6trPoQ

【エンタメ系チャンネル】
https://www.youtube.com/channel/UCiPr3RQd39CFUV1NXZMtWLA

概要欄からクリックしてみてください！`;

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

async function alreadyCommented(videoId) {
  let token;
  do {
    const r = await youtube.commentThreads.list({ part: ["snippet"], videoId, maxResults: 100, pageToken: token });
    for (const t of r.data.items ?? []) {
      const c = t.snippet.topLevelComment.snippet;
      if (c.authorChannelId?.value === channelId && c.textOriginal?.includes(MARKER)) return true;
    }
    token = r.data.nextPageToken;
  } while (token);
  return false;
}

const now = Date.now();
let posted = 0;
let backlogPosted = 0;
let remaining = 0;
for (const v of publicVideos) {
  if (await alreadyCommented(v.id)) continue;
  const isNew = now - new Date(v.snippet.publishedAt).getTime() < NEW_VIDEO_HOURS * 3600 * 1000;
  if (!isNew && backlogPosted >= BACKLOG_PER_RUN) {
    remaining++;
    continue;
  }
  await youtube.commentThreads.insert({
    part: ["snippet"],
    requestBody: {
      snippet: { channelId, videoId: v.id, topLevelComment: { snippet: { textOriginal: COMMENT_TEXT } } },
    },
  });
  posted++;
  if (!isNew) backlogPosted++;
  console.log(`投稿: ${v.id} ${v.snippet.title}`);
}
console.log(`完了: 今回${posted}件投稿 / 未投稿の残り${remaining}件(公開中${publicVideos.length}本)`);
