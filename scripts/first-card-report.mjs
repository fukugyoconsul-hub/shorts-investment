import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { google } from "googleapis";
import { assignVariant, loadExperiment } from "./first-card-test.mjs";

// 案1テストの週次の集計。新旧の動画を、公開から一定日数が経ったものだけで比べて記録する。
// 基準を両方満たせば成功。片方だけなら失敗とせず、本数を増やして続ける。
// どちらも満たさない場合も自動では何も変えず、記録して判断を仰ぐ。

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
const SHEET = "TACグループ_案1テスト";

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (a) => a.reduce((x, y) => x + y, 0);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Analyticsの日付は米太平洋時間
function pacificDate(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export async function videoStats(analytics, videoId, publishedAt) {
  const endDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const base = { ids: "channel==MINE", startDate: pacificDate(publishedAt), endDate, filters: `video==${videoId}` };
  const days = await analytics.reports.query({ ...base, dimensions: "day", metrics: "views", sort: "day" });
  const sources = await analytics.reports.query({ ...base, dimensions: "insightTrafficSourceType", metrics: "views,engagedViews" });
  const overall = await analytics.reports.query({
    ...base,
    metrics: "views,engagedViews,averageViewPercentage,averageViewDuration,subscribersGained",
  });

  const start = new Date(base.startDate).getTime();
  let threeDayViews = 0;
  for (const [day, views] of days.data.rows ?? []) {
    if ((new Date(day).getTime() - start) / 86400000 <= 2) threeDayViews += views;
  }
  const feed = (sources.data.rows ?? []).find((r) => r[0] === "SHORTS") ?? ["SHORTS", 0, 0];
  const [views = 0, engaged = 0, avgPct = 0, avgSec = 0, subs = 0] = overall.data.rows?.[0] ?? [];
  return {
    threeDayViews,
    feedViews: feed[1],
    feedEngaged: feed[2],
    feedEngagedRate: feed[1] > 0 ? (feed[2] / feed[1]) * 100 : null,
    views,
    engaged,
    avgPct,
    avgSec,
    subs,
  };
}

function summarize(rows) {
  const views = sum(rows.map((r) => r.views));
  const subs = sum(rows.map((r) => r.subs));
  return {
    count: rows.length,
    feedEngagedRateMedian: round1(median(rows.map((r) => r.feedEngagedRate).filter((x) => x != null))),
    threeDayViewsMedian: median(rows.map((r) => r.threeDayViews)),
    totalViews: views,
    subscribersGained: subs,
    subscribersPer1000Views: views ? Math.round((subs / views) * 10000) / 10 : null,
    avgViewPercentageMedian: round1(median(rows.map((r) => r.avgPct))),
  };
}

export function judge(newArm, oldArm, experiment) {
  const { engagedRatePointsAtLeast, threeDayViewsRatioAtLeast } = experiment.criteria;
  const diff =
    newArm.feedEngagedRateMedian != null && oldArm.feedEngagedRateMedian != null
      ? round1(newArm.feedEngagedRateMedian - oldArm.feedEngagedRateMedian)
      : null;
  const ratio =
    oldArm.threeDayViewsMedian > 0
      ? Math.round((newArm.threeDayViewsMedian / oldArm.threeDayViewsMedian) * 100) / 100
      : null;
  const engagedMet = diff != null && diff >= engagedRatePointsAtLeast;
  const viewsMet = ratio != null && ratio >= threeDayViewsRatioAtLeast;
  let verdict;
  if (Math.min(newArm.count, oldArm.count) < experiment.targetPerArm) verdict = "本数不足(判定待ち)";
  else if (engagedMet && viewsMet) verdict = "成功";
  else if (engagedMet || viewsMet) verdict = "片方のみ達成(本数を増やして継続)";
  else verdict = "両方未達(判断を仰ぐ)";
  return { verdict, engagedRateDiffPoints: diff, threeDayViewsRatio: ratio, engagedMet, viewsMet };
}

async function main() {
  const experiment = loadExperiment();
  const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
  const oauth = new google.auth.OAuth2(installed.client_id, installed.client_secret);
  oauth.setCredentials(JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8")));
  const youtube = google.youtube({ version: "v3", auth: oauth });
  const analytics = google.youtubeAnalytics({ version: "v2", auth: oauth });

  const topics = JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8"));
  const firstSlot = topics
    .filter((t) => t.videoId && t.firstCardVariant)
    .map((t) => t.publishedAt)
    .sort()[0];
  // 記録が欠けた動画は、投稿時刻から割り当てを復元する
  const targets = firstSlot
    ? topics
        .filter((t) => t.videoId && t.publishedAt >= firstSlot)
        .map((t) => ({ ...t, firstCardVariant: t.firstCardVariant ?? assignVariant(t.publishedAt, experiment) }))
        .filter((t) => t.firstCardVariant)
    : [];

  const now = Date.now();
  const rows = [];
  let tooNew = 0;
  for (let i = 0; i < targets.length; i += 50) {
    const batch = targets.slice(i, i + 50);
    const r = await youtube.videos.list({ part: ["status", "snippet"], id: batch.map((t) => t.videoId) });
    const byId = new Map(r.data.items.map((v) => [v.id, v]));
    for (const t of batch) {
      const v = byId.get(t.videoId);
      if (!v || v.status.privacyStatus !== "public") continue;
      if ((now - new Date(v.snippet.publishedAt)) / 86400000 < experiment.minAgeDays) {
        tooNew++;
        continue;
      }
      rows.push({
        videoId: t.videoId,
        title: t.title,
        variant: t.firstCardVariant,
        publishedAt: v.snippet.publishedAt,
        ...(await videoStats(analytics, t.videoId, v.snippet.publishedAt)),
      });
    }
  }

  const newArm = summarize(rows.filter((r) => r.variant === "new"));
  const oldArm = summarize(rows.filter((r) => r.variant === "old"));
  const result = judge(newArm, oldArm, experiment);
  const report = {
    date: new Date().toISOString().slice(0, 10),
    experiment: experiment.id,
    ...result,
    newArm,
    oldArm,
    tooNew,
    videos: rows,
  };
  fs.writeFileSync(path.join(root, "content", "first-card-test-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, videos: undefined }, null, 2));

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(root, "service-account.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const book = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  if (!book.data.sheets.some((s) => s.properties.title === SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A1:N1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "集計日",
            "判定",
            "新型の本数",
            "旧型の本数",
            "フィードのエンゲージ率(新)",
            "フィードのエンゲージ率(旧)",
            "差(ポイント)",
            "3日間再生の中央値(新)",
            "3日間再生の中央値(旧)",
            "倍率",
            "獲得登録者(新)",
            "獲得登録者(旧)",
            "1000再生あたり登録者(新)",
            "1000再生あたり登録者(旧)",
          ],
        ],
      },
    });
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A:N`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          report.date,
          result.verdict,
          newArm.count,
          oldArm.count,
          newArm.feedEngagedRateMedian,
          oldArm.feedEngagedRateMedian,
          result.engagedRateDiffPoints,
          newArm.threeDayViewsMedian,
          oldArm.threeDayViewsMedian,
          result.threeDayViewsRatio,
          newArm.subscribersGained,
          oldArm.subscribersGained,
          newArm.subscribersPer1000Views,
          oldArm.subscribersPer1000Views,
        ].map((x) => x ?? "-"),
      ],
    },
  });
  console.log(`OK: ${SHEET}タブに記録しました`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
