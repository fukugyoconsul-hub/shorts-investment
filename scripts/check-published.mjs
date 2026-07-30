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

const usedTopics = JSON.parse(
  fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")
);
const now = new Date();

// 予約公開の予定時刻(publishedAt)を、猶予時間を含めても過ぎている動画
const overdue = usedTopics.filter((t) => {
  if (!t.publishedAt || !t.videoId) return false;
  const scheduled = new Date(t.publishedAt);
  return now.getTime() > scheduled.getTime() + GRACE_MINUTES * 60 * 1000;
});

if (overdue.length === 0) {
  console.log("OK: 公開予定時刻を過ぎた動画はありません");
  process.exit(0);
}

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// シート上の現在のステータス(C列)とURL(I列)をまとめて取得し、すでに「予約済み」以外
// (投稿完了・エラー等、判定済み)になっている行は再チェック対象から除外する
// (無駄なYouTube API・Sheets API呼び出しを避けるため)
const [statusColumn, urlColumn] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!C:C` }),
  sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!I:I` }),
]);
const statusValues = statusColumn.data.values ?? [];
const urlValues = urlColumn.data.values ?? [];

function findRowForVideoId(videoId) {
  const rowIndex = urlValues.findIndex((row) => row[0]?.includes(videoId));
  return rowIndex === -1 ? null : rowIndex + 1; // 1-indexed行番号
}

const toCheck = [];
for (const t of overdue) {
  const row = findRowForVideoId(t.videoId);
  if (row === null) {
    console.error(`該当行が見つかりませんでした(videoId: ${t.videoId})`);
    continue;
  }
  const currentStatus = statusValues[row - 1]?.[0]?.trim();
  if (currentStatus && currentStatus !== "予約済み") {
    // 既に「投稿完了」「エラー」等に判定済みなのでスキップ
    continue;
  }
  toCheck.push({ ...t, row });
}

if (toCheck.length === 0) {
  console.log("OK: 再チェックが必要な動画はありません(すべて判定済み)");
  process.exit(0);
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const res = await youtube.videos.list({
  part: ["status"],
  id: toCheck.map((t) => t.videoId),
});
const statusById = new Map(res.data.items.map((v) => [v.id, v.status.privacyStatus]));

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
          `予約公開の予定時刻(${t.publishedAt})を${GRACE_MINUTES}分以上過ぎましたが、YouTube側で公開されていません(現在の状態: ${actualStatusLabel})。YouTube Studioで内容を確認してください。videoId: ${t.videoId}`,
        ],
      ],
    },
  });
  errorCount++;
  console.error(`警告: ${t.row}行目を「エラー」に更新しました (videoId: ${t.videoId}, 状態: ${actualStatusLabel})`);
}

console.log(`完了: 投稿完了${completedCount}件、エラー${errorCount}件`);
