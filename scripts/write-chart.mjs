import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 台本で指定されたグラフ(chart)を、動画に描画するためのデータ(src/chart.ts)として書き出す。
// 指定が無い・不正・データが無い場合は必ず null を書く(前回の動画のグラフが残らないようにするため)。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = path.join(root, "src", "chart.ts");
const MAX_POINTS = 90;
const CHART_SEGMENTS = ["rank3", "rank2", "rank1"];

function write(chart) {
  fs.writeFileSync(
    outPath,
    `export type ChartData = {
  segmentId: string;
  title: string;
  label: string;
  unit: string;
  decimals: number;
  source: string;
  points: { t: string; v: number }[];
};

export const chart: ChartData | null = ${JSON.stringify(chart, null, 2)};
`
  );
}

function downsample(points) {
  if (points.length <= MAX_POINTS) return points;
  const step = (points.length - 1) / (MAX_POINTS - 1);
  const out = [];
  for (let i = 0; i < MAX_POINTS; i++) out.push(points[Math.round(i * step)]);
  return out;
}

try {
  const script = JSON.parse(fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8"));
  const spec = script.chart;
  const dataPath = path.join(root, ".cache", "market-data.json");
  const series = spec && fs.existsSync(dataPath)
    ? JSON.parse(fs.readFileSync(dataPath, "utf-8")).series[spec.seriesId]
    : null;

  if (!spec) {
    write(null);
    console.log("グラフ指定なし");
  } else if (!series || !CHART_SEGMENTS.includes(spec.segment) || !script.segments.some((s) => s.id === spec.segment)) {
    write(null);
    console.log(`グラフ指定が不正なため表示しません: ${JSON.stringify(spec)}`);
  } else {
    const startYear = Number.isInteger(spec.startYear) ? spec.startYear : 2015;
    let points = series.points.filter((p) => p.t >= `${startYear}-01-01`);
    if (points.length < 5) points = series.points.slice(-60);
    write({
      segmentId: spec.segment,
      title: String(spec.title ?? series.label).slice(0, 24),
      label: series.label,
      unit: series.unit,
      decimals: series.decimals,
      source: "出典: FRED(米セントルイス連銀)",
      points: downsample(points),
    });
    console.log(`OK: グラフ「${spec.title}」(${series.label}, ${spec.segment})を書き出しました`);
  }
} catch (err) {
  write(null);
  console.error(`グラフの書き出しに失敗したため表示しません: ${err.message}`);
}
