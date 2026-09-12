import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
// このスプレッドシートは複数チャンネルで共有しているため、タブ名を固定で指定する
// (先頭タブ=sheets[0]は別チャンネル「ほっと一息チャンネル」のタブなので、絶対に参照しないこと)
const SHEET_NAME = "TACグループ";

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const sheet = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
if (!sheet) throw new Error(`シート「${SHEET_NAME}」が見つかりません`);
const sheetId = sheet.properties.sheetId;

// 「エラー」行を削除する
const statusCol = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!C:C`,
});
const statusValues = statusCol.data.values ?? [];

const errorRowIndices = [];
for (let i = 1; i < statusValues.length; i++) {
  if (statusValues[i]?.[0]?.trim() === "エラー") errorRowIndices.push(i);
}

if (errorRowIndices.length > 0) {
  errorRowIndices.sort((a, b) => b - a);
  const ranges = [];
  let rangeEnd = errorRowIndices[0];
  let rangeStart = errorRowIndices[0];
  for (let i = 1; i <= errorRowIndices.length; i++) {
    const cur = errorRowIndices[i];
    if (cur === rangeStart - 1) {
      rangeStart = cur;
    } else {
      ranges.push({ startIndex: rangeStart, endIndex: rangeEnd + 1 });
      if (cur !== undefined) {
        rangeStart = cur;
        rangeEnd = cur;
      }
    }
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: ranges.map((r) => ({
        deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: r.startIndex, endIndex: r.endIndex } },
      })),
    },
  });
  console.log(`削除: エラー行 ${errorRowIndices.length}件`);
} else {
  console.log("エラー行はありませんでした");
}

// 投稿日時(E列)昇順で並べ替える(A列のNo.は=ROW()-1の数式なので対象外にし、自動で振り直させる)
const dateCol = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!E:E`,
});
const dateValues = dateCol.data.values ?? [];
let lastRow = 1;
for (let i = 1; i < dateValues.length; i++) {
  if (dateValues[i]?.[0]?.trim()) lastRow = i + 1;
}

if (lastRow > 1) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          sortRange: {
            range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: 1, endColumnIndex: 11 },
            sortSpecs: [{ dimensionIndex: 4, sortOrder: "ASCENDING" }],
          },
        },
      ],
    },
  });
  console.log(`並べ替え完了(最終行: ${lastRow})`);
}

console.log("OK: エラー行の整理・並べ替えが完了しました");
