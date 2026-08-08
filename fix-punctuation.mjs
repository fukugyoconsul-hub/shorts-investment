import fs from "node:fs";
import { google } from "googleapis";

const root = ".";
const { installed } = JSON.parse(fs.readFileSync(`${root}/client_secret.json`, "utf-8"));
const tokens = JSON.parse(fs.readFileSync(`${root}/youtube-token.json`, "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const auth = new google.auth.GoogleAuth({
  keyFile: `${root}/service-account.json`,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
const SHEET_NAME = "TACグループ";

function normalize(text) {
  return text.replace(/!/g, "！").replace(/\?/g, "？");
}

const usedTopicsPath = `${root}/content/used-topics.json`;
const usedTopics = JSON.parse(fs.readFileSync(usedTopicsPath, "utf-8"));

const urlColumn = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!I:I`,
});
const urlValues = urlColumn.data.values ?? [];

let fixedCount = 0;
for (const entry of usedTopics) {
  if (!entry.videoId) continue;
  const newTitle = normalize(entry.title);
  if (newTitle === entry.title) continue;

  console.log(`修正: "${entry.title}" -> "${newTitle}"`);

  const res = await youtube.videos.list({ part: ["snippet"], id: [entry.videoId] });
  const video = res.data.items?.[0];
  if (!video) {
    console.log(`  スキップ(YouTube上に見つかりません): ${entry.videoId}`);
    continue;
  }

  await youtube.videos.update({
    part: ["snippet"],
    requestBody: {
      id: entry.videoId,
      snippet: {
        title: newTitle,
        description: video.snippet.description,
        tags: video.snippet.tags,
        categoryId: video.snippet.categoryId,
      },
    },
  });
  console.log(`  OK: YouTube更新`);

  const rowIndex = urlValues.findIndex((row) => row[0]?.includes(entry.videoId));
  if (rowIndex !== -1) {
    const row = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!F${row}:F${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[newTitle]] },
    });
    console.log(`  OK: シート${row}行目のF列も更新`);
  } else {
    console.log(`  警告: シート上で該当行が見つかりませんでした`);
  }

  entry.title = newTitle;
  fixedCount++;
}

fs.writeFileSync(usedTopicsPath, JSON.stringify(usedTopics, null, 2));
console.log(`\n完了: ${fixedCount}件のタイトルを修正しました`);
