import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

// メインチャンネル(TACテクニカル分析講座)の公開動画一覧を取得し、関連動画選びの候補として保存する。
const MAIN_CHANNEL_ID = "UCpmL0HqTr-rqJSoSa6trPoQ";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8")));
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const ch = await youtube.channels.list({ part: ["contentDetails"], id: [MAIN_CHANNEL_ID] });
const uploadsId = ch.data.items[0].contentDetails.relatedPlaylists.uploads;

const videos = [];
let pageToken;
do {
  const r = await youtube.playlistItems.list({ part: ["snippet", "status"], playlistId: uploadsId, maxResults: 50, pageToken });
  for (const i of r.data.items) {
    if (i.status?.privacyStatus && i.status.privacyStatus !== "public") continue;
    videos.push({ id: i.snippet.resourceId.videoId, title: i.snippet.title, publishedAt: i.snippet.publishedAt });
  }
  pageToken = r.data.nextPageToken;
} while (pageToken);

fs.writeFileSync(path.join(root, "content", "main-channel-videos.json"), JSON.stringify(videos, null, 2) + "\n");
console.log(`OK: メインチャンネルの動画${videos.length}本を保存しました`);
