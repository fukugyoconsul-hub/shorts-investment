import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

// 週次のPDCA。目標「直近30日以内に投稿した動画が1万回以上再生」に向けて、
// 実績を集計→前週の施策を検証→次週の改善方針(台本生成に自動で反映)と試す仮説を決め、
// 記録(content/pdca-log.json)とスプレッドシートの「TACグループ_PDCA」タブに残す。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const GOAL_VIEWS = 10000;
const GOAL_WINDOW_DAYS = 30;
const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
const PDCA_SHEET = "TACグループ_PDCA";
const logPath = path.join(root, "content", "pdca-log.json");
const directivesPath = path.join(root, "content", "pdca-directives.json");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf-8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function runClaude(promptText) {
  const env = loadEnv();
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`claude -p が失敗しました: ${err}`))));
    child.stdin.write(promptText);
    child.stdin.end();
  });
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8")));
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// 1. 実績の集計(チャンネル上の公開動画を正とし、used-topics.jsonの記録で施策の有無を補う)
const ch = await youtube.channels.list({ part: ["contentDetails", "statistics"], mine: true });
const uploadsId = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
const subscribers = Number(ch.data.items[0].statistics.subscriberCount);
const ids = [];
let pageToken;
do {
  const r = await youtube.playlistItems.list({ part: ["contentDetails"], playlistId: uploadsId, maxResults: 50, pageToken });
  ids.push(...r.data.items.map((i) => i.contentDetails.videoId));
  pageToken = r.data.nextPageToken;
} while (pageToken);

const meta = new Map(
  JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8"))
    .filter((t) => t.videoId)
    .map((t) => [t.videoId, t])
);
const now = Date.now();
const rows = [];
for (let i = 0; i < ids.length; i += 50) {
  const r = await youtube.videos.list({ part: ["snippet", "statistics", "status"], id: ids.slice(i, i + 50) });
  for (const v of r.data.items) {
    if (v.status.privacyStatus !== "public") continue;
    const m = meta.get(v.id) ?? {};
    const ageDays = Math.max(0.5, (now - new Date(v.snippet.publishedAt)) / 86400000);
    const views = Number(v.statistics.viewCount ?? 0);
    rows.push({
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt.slice(0, 10),
      ageDays: Math.round(ageDays),
      views,
      viewsPerDay: Math.round((views / ageDays) * 10) / 10,
      likes: Number(v.statistics.likeCount ?? 0),
      comments: Number(v.statistics.commentCount ?? 0),
      category: m.category ?? "-",
      format: m.format ?? "-",
      chart: m.chart ?? null,
      newsAngle: m.newsAngle ? "あり" : m.chart === undefined ? "記録なし" : "なし",
    });
  }
}
rows.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

const recent = rows.filter((r) => r.ageDays <= GOAL_WINDOW_DAYS);
const best = recent.reduce((a, b) => (b.views > (a?.views ?? -1) ? b : a), null);
const achieved = (best?.views ?? 0) >= GOAL_VIEWS;
console.log(`直近${GOAL_WINDOW_DAYS}日の最高再生: ${best?.views ?? 0}回「${best?.title ?? "-"}」 → 目標${achieved ? "達成" : "未達"}`);

// 2. 検証と次週の方針をAIで作る(過去の記録も渡して、施策の効果を追いかける)
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, "utf-8")) : [];
const table = rows
  .slice(0, 80)
  .map((r) =>
    [r.publishedAt, r.title, r.views, r.viewsPerDay, r.likes, r.comments, r.category, r.format, r.chart ?? "-", r.newsAngle].join(" | ")
  )
  .join("\n");

const prompt = `あなたはYouTubeショートの運用分析の担当者です。投資・金融の教育系ショートチャンネル(登録者${subscribers}人、1日2本の自動投稿)の週次PDCAを行ってください。

# 目標
直近${GOAL_WINDOW_DAYS}日以内に投稿した動画のいずれかが${GOAL_VIEWS.toLocaleString()}回以上再生されること。現在の最高は${best?.views ?? 0}回(「${best?.title ?? "-"}」)。

# 動画ごとの実績(新しい順。投稿日 | タイトル | 再生数 | 1日あたり再生 | 高評価 | コメント | ジャンル | 形式 | 実データグラフ | ニュースの切り口)
${table}

# 過去のPDCA記録(古い順、直近4回)
${JSON.stringify(log.slice(-4), null, 1)}

# 制約(改善方針はこの範囲で)
- 変えられるのは、台本(テーマ選び・タイトル・フック・構成・テロップ・タグ)とその方向性のみ。動画の尺・投稿本数・声・BGMは対象外
- 投資の勧誘・売買の推奨・価格予測・利益保証・特定業者の推奨・実在人物(著名人を含む)の扱い・政治的主張につながる方針は絶対に出さない
- 同じテーマの動画を複数本作る方針(フック違いのバリエーション・ABテスト目的の重複投稿など)は絶対に出さない。YouTubeの収益化審査で「繰り返しの多い量産型コンテンツ」と判定されるリスクがあるため。比較は、別テーマの動画同士で行うこと
- データが少なく差がはっきりしない場合は、断定せずに「検証を続ける」とすること。1本だけ伸びた等の偶然に引きずられないこと

# 出力(説明文やコードフェンスは付けず、JSONのみ)
{
  "check": "前回の仮説・方針の検証結果(前回記録が無ければ現状分析)。数値を挙げて2〜3文",
  "findings": ["データから読み取れる伸びる動画・伸びない動画の傾向(数値つき、最大4つ)"],
  "directives": ["次週の台本生成に反映する具体的な改善指示(最大5つ。台本作家がそのまま実行できる具体性で)"],
  "experiment": "次週に検証する仮説を1つと、成功の判定基準"
}`;

const raw = await runClaude(prompt);
const result = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));

const entry = {
  date: new Date().toISOString().slice(0, 10),
  subscribers,
  bestRecentViews: best?.views ?? 0,
  bestRecentTitle: best?.title ?? null,
  achieved,
  ...result,
};
log.push(entry);
fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");
fs.writeFileSync(
  directivesPath,
  JSON.stringify({ updatedAt: entry.date, directives: result.directives ?? [], experiment: result.experiment ?? "" }, null, 2) + "\n"
);
console.log(`検証: ${result.check}\n次週の方針:\n- ${(result.directives ?? []).join("\n- ")}\n仮説: ${result.experiment}`);

// 3. スプレッドシートに記録(タブが無ければ作る)
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const book = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
if (!book.data.sheets.some((s) => s.properties.title === PDCA_SHEET)) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: PDCA_SHEET } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${PDCA_SHEET}!A1:H1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["実施日", "登録者数", `直近${GOAL_WINDOW_DAYS}日の最高再生`, "その動画", "目標(1万回)", "検証", "次週の改善方針", "次週の仮説"]],
    },
  });
}
await sheets.spreadsheets.values.append({
  spreadsheetId: SPREADSHEET_ID,
  range: `${PDCA_SHEET}!A:H`,
  valueInputOption: "USER_ENTERED",
  requestBody: {
    values: [
      [
        entry.date,
        subscribers,
        entry.bestRecentViews,
        entry.bestRecentTitle ?? "-",
        achieved ? "達成" : "未達",
        result.check ?? "",
        (result.directives ?? []).map((d) => `・${d}`).join("\n"),
        result.experiment ?? "",
      ],
    ],
  },
});
console.log(`OK: ${PDCA_SHEET}タブに記録しました`);
