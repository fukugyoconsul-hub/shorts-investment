import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
// このスプレッドシートは複数チャンネルで共有しているため、タブ名を固定で指定する
// (先頭タブ=sheets[0]は別チャンネル「ほっと一息チャンネル」のタブなので、絶対に参照しないこと)
const SHEET_NAME = "TACグループ";
const GRACE_MINUTES = 30; // YouTube側の処理猶予(予定時刻ちょうどでは間に合わないことがあるため)

// シート上の「投稿日時」(例: "2026/8/25 16:00")はJSTの壁時計時刻として書き込まれているため、
// そのままDateにparseすると実行環境のタイムゾーン次第で解釈がズレる。明示的にJST→UTC変換する。
function parseJstDatetime(str) {
  const m = str?.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// シート自体を信頼できる情報源として、ステータス(C列)・投稿日時(E列)・URL(I列)を直接見て判定する。
// (以前はcontent/used-topics.jsonとの突き合わせに依存していたが、そのファイルへの記録が
// 何らかの理由で1件でも漏れると、その動画が自動チェックから永久に漏れ続ける弱点があった)
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!A2:K`,
});
const rows = res.data.values ?? [];

const now = new Date();
const toCheck = [];
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const status = row[2]?.trim(); // C列
  if (status !== "予約済み") continue;

  const scheduled = parseJstDatetime(row[4]); // E列
  if (!scheduled || now.getTime() <= scheduled.getTime() + GRACE_MINUTES * 60 * 1000) continue;

  const url = row[8]; // I列
  const videoIdMatch = url?.match(/shorts\/([a-zA-Z0-9_-]{6,})/);
  if (!videoIdMatch) {
    console.error(`行${i + 2}: 予約時刻を過ぎていますが動画URLが見つかりません`);
    continue;
  }
  toCheck.push({ row: i + 2, videoId: videoIdMatch[1], scheduled });
}

if (toCheck.length === 0) {
  console.log("OK: 再チェックが必要な動画はありません");
  process.exit(0);
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const res2 = await youtube.videos.list({
  part: ["status"],
  id: toCheck.map((t) => t.videoId),
});
const statusById = new Map(res2.data.items.map((v) => [v.id, v.status.privacyStatus]));

let completedCount = 0;
let errorCount = 0;

for (const t of toCheck) {
  const actualStatus = statusById.get(t.videoId);

  if (actualStatus === "public") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!C${t.row}:C${t.row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["投稿完了"]] },
    });
    completedCount++;
    console.log(`OK: ${t.row}行目を「投稿完了」に更新しました (videoId: ${t.videoId})`);
    continue;
  }

  // YouTube API上に存在しない(削除された等)場合も「公開されていない」扱いにする
  const actualStatusLabel = actualStatus ?? "取得不可(削除された可能性)";
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!C${t.row}:C${t.row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["エラー"]] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!K${t.row}:K${t.row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          `予約公開の予定時刻(${t.scheduled.toISOString()})を${GRACE_MINUTES}分以上過ぎましたが、YouTube側で公開されていません(現在の状態: ${actualStatusLabel})。YouTube Studioで内容を確認してください。videoId: ${t.videoId}`,
        ],
      ],
    },
  });
  errorCount++;
  console.error(`警告: ${t.row}行目を「エラー」に更新しました (videoId: ${t.videoId}, 状態: ${actualStatusLabel})`);
}

console.log(`完了: 投稿完了${completedCount}件、エラー${errorCount}件`);
