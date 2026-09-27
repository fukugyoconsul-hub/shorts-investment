import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

// 動画をジャンルごとのシリーズ(再生リスト)に自動で追加する。企画としての一貫性を示し、連続視聴も促す。
// 再生リストへの追加はAPIの消費量が大きいため1回あたりの件数を絞り、上限に達したらエラーにせず次回に回す。
const MAX_ADD_PER_RUN = 10;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const series = JSON.parse(fs.readFileSync(path.join(root, "scripts", "series.json"), "utf-8"));
const seriesByCategory = new Map(series.flatMap((s) => s.categories.map((c) => [c, s])));

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8")));
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

function isQuotaError(err) {
  return err?.errors?.some((e) => e.reason === "quotaExceeded") || /quota/i.test(err?.message ?? "");
}

try {
  // 既存の再生リストを取得し、無いシリーズは作る
  const playlists = [];
  let pageToken;
  do {
    const r = await youtube.playlists.list({ part: ["snippet"], mine: true, maxResults: 50, pageToken });
    playlists.push(...r.data.items);
    pageToken = r.data.nextPageToken;
  } while (pageToken);

  const playlistIdByTitle = new Map(playlists.map((p) => [p.snippet.title, p.id]));
  for (const s of series) {
    if (playlistIdByTitle.has(s.title)) continue;
    const r = await youtube.playlists.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title: s.title, description: s.description },
        status: { privacyStatus: "public" },
      },
    });
    playlistIdByTitle.set(s.title, r.data.id);
    console.log(`再生リストを作成: ${s.title}`);
  }

  // 各再生リストに入っている動画
  const membersByPlaylist = new Map();
  for (const s of series) {
    const id = playlistIdByTitle.get(s.title);
    const members = new Set();
    let token;
    do {
      const r = await youtube.playlistItems.list({ part: ["contentDetails"], playlistId: id, maxResults: 50, pageToken: token });
      for (const i of r.data.items) members.add(i.contentDetails.videoId);
      token = r.data.nextPageToken;
    } while (token);
    membersByPlaylist.set(id, members);
  }

  // 新しい動画から順に、未追加のものを追加する
  const topics = JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8"))
    .filter((t) => t.videoId && seriesByCategory.has(t.category))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  const unmapped = [...new Set(JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")).filter((t) => t.videoId && !seriesByCategory.has(t.category)).map((t) => t.category))];
  if (unmapped.length) console.log(`シリーズ未割当のジャンル(scripts/series.jsonに追加が必要): ${unmapped.join(", ")}`);

  let added = 0;
  let pending = 0;
  for (const t of topics) {
    const playlistId = playlistIdByTitle.get(seriesByCategory.get(t.category).title);
    const members = membersByPlaylist.get(playlistId);
    if (members.has(t.videoId)) continue;
    if (added >= MAX_ADD_PER_RUN) {
      pending++;
      continue;
    }
    try {
      await youtube.playlistItems.insert({
        part: ["snippet"],
        requestBody: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId: t.videoId } } },
      });
    } catch (err) {
      if (isQuotaError(err)) throw err;
      // 削除済みの動画などは飛ばす
      console.error(`スキップ: ${t.videoId} ${t.title}(${err.message})`);
      continue;
    }
    members.add(t.videoId);
    added++;
    console.log(`追加: ${seriesByCategory.get(t.category).title} ← ${t.title}`);
  }
  console.log(`完了: 今回${added}本追加 / 未追加の残り${pending}本`);
} catch (err) {
  if (isQuotaError(err)) {
    console.log("YouTube APIの1日の上限に達したため、残りは次回に回します");
    process.exit(0);
  }
  throw err;
}
