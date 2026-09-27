import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 米セントルイス連銀の公開統計(FRED)から主要指標の実データを取得し、台本生成とグラフ表示に使う。
// 台本を書くAIの知識は古いことがあるため、数字は必ずこの実データに合わせる(generate-script.mjs参照)。
// 取得に失敗した系列は単に使わないだけで、動画作成自体は止めない。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = path.join(root, ".cache", "market-data.json");
const START = "2005-01-01";

const series = JSON.parse(fs.readFileSync(path.join(root, "scripts", "chart-series.json"), "utf-8"));

async function fetchSeries(s) {
  const params = new URLSearchParams({ id: s.id, cosd: START });
  if (s.transformation) params.set("transformation", s.transformation);
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?${params}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/);
  if (!lines[0].startsWith("observation_date")) throw new Error("CSVではない応答");
  const points = [];
  for (const line of lines.slice(1)) {
    const [t, raw] = line.split(",");
    const v = Number(raw);
    if (raw && raw !== "." && Number.isFinite(v)) points.push({ t, v });
  }
  if (points.length < 5) throw new Error("データ不足");
  return points;
}

function valueAtOrBefore(points, isoDate) {
  let found = null;
  for (const p of points) {
    if (p.t <= isoDate) found = p;
    else break;
  }
  return found;
}

function yearsBefore(isoDate, years) {
  const d = new Date(isoDate);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function summarize(points) {
  const latest = points[points.length - 1];
  const tenYearsAgo = yearsBefore(latest.t, 10);
  const recent = points.filter((p) => p.t >= tenYearsAgo);
  const max = recent.reduce((a, b) => (b.v > a.v ? b : a));
  const min = recent.reduce((a, b) => (b.v < a.v ? b : a));
  return {
    latest,
    oneYearAgo: valueAtOrBefore(points, yearsBefore(latest.t, 1)),
    fiveYearsAgo: valueAtOrBefore(points, yearsBefore(latest.t, 5)),
    tenYearMax: max,
    tenYearMin: min,
  };
}

const result = { fetchedAt: new Date().toISOString(), series: {} };
for (const s of series) {
  try {
    const points = await fetchSeries(s);
    result.series[s.id] = { ...s, points, summary: summarize(points) };
    console.log(`OK: ${s.label} 最新 ${points[points.length - 1].t} = ${points[points.length - 1].v}`);
  } catch (err) {
    console.error(`スキップ: ${s.label}(${s.id}) の取得に失敗しました: ${err.message}`);
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result));
console.log(`OK: ${Object.keys(result.series).length}/${series.length}系列を保存しました`);
