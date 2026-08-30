import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const tokenPath = path.join(root, "content", "tiktok-token.json");
const videoPath = path.join(root, "out", "final.mp4");
const scriptPath = path.join(root, "content", "latest-script.json");

function loadEnv() {
  const text = fs.readFileSync(path.join(root, ".env"), "utf-8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}
const env = loadEnv();

const CLIENT_KEY = env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = env.TIKTOK_CLIENT_SECRET;
if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET が .env に見つかりません");
  process.exit(1);
}

const stored = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));

// TikTokのrefresh_tokenは使うたびにローテーション(値が変わる)するため、
// 毎回リフレッシュしてその場でaccess_tokenを取得し、新しいrefresh_tokenを保存し直す
const refreshRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new URLSearchParams({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
  }),
});
const refreshJson = await refreshRes.json();
if (!refreshJson.access_token) {
  throw new Error(`トークンのリフレッシュに失敗しました: ${JSON.stringify(refreshJson)}`);
}

fs.writeFileSync(
  tokenPath,
  JSON.stringify(
    { refresh_token: refreshJson.refresh_token, open_id: refreshJson.open_id },
    null,
    2
  ) + "\n"
);

const { title } = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
const videoSize = fs.statSync(videoPath).size;

const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${refreshJson.access_token}`,
    "Content-Type": "application/json; charset=UTF-8",
  },
  body: JSON.stringify({
    post_info: {
      title: title.slice(0, 90),
      // 審査未通過(unaudited)のアプリは SELF_ONLY 以外での投稿が許可されないため、
      // 審査が通ってPRODUCTIONとして承認されるまではこの設定のままにする
      privacy_level: "SELF_ONLY",
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: videoSize,
      total_chunk_count: 1,
    },
  }),
});
const initJson = await initRes.json();
if (initJson.error?.code !== "ok") {
  throw new Error(`init失敗: ${JSON.stringify(initJson.error)}`);
}

const { publish_id, upload_url } = initJson.data;
const videoBuffer = fs.readFileSync(videoPath);
const uploadRes = await fetch(upload_url, {
  method: "PUT",
  headers: {
    "Content-Type": "video/mp4",
    "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
  },
  body: videoBuffer,
});
if (!uploadRes.ok) {
  const text = await uploadRes.text();
  throw new Error(`アップロード失敗: ${uploadRes.status} ${text}`);
}

console.log(`OK: TikTokに投稿しました (publish_id: ${publish_id})`);
