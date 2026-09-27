import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { ChartData } from "./chart";

const PANEL_WIDTH = 960;
const PLOT_WIDTH = 860;
const PLOT_HEIGHT = 460;

function formatValue(v: number, decimals: number, unit: string) {
  const text = v.toLocaleString("ja-JP", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${text}${unit}`;
}

function formatDate(t: string) {
  const [y, m] = t.split("-");
  return `${y}/${m}`;
}

// 実データの折れ線グラフ。セグメントの前半7割をかけて線が左から描かれ、最後に最新値が表示される。
export const ChartPanel: React.FC<{ chart: ChartData; durationInFrames: number; fontFamily: string }> = ({
  chart,
  durationInFrames,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { points, decimals, unit } = chart;

  const values = points.map((p) => p.v);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.1;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const xy = points.map((p, i) => ({
    x: (i / (points.length - 1)) * PLOT_WIDTH,
    y: PLOT_HEIGHT - ((p.v - min) / (max - min)) * PLOT_HEIGHT,
  }));
  const segLengths = xy.slice(1).map((p, i) => Math.hypot(p.x - xy[i].x, p.y - xy[i].y));
  const totalLength = segLengths.reduce((a, b) => a + b, 0);
  const d = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const drawEnd = Math.max(20, Math.round(durationInFrames * 0.7));
  const progress = interpolate(frame, [6, drawEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  // 描画中の先端の位置
  let remaining = totalLength * progress;
  let tip = xy[0];
  for (let i = 0; i < segLengths.length; i++) {
    if (remaining <= segLengths[i]) {
      const r = segLengths[i] === 0 ? 0 : remaining / segLengths[i];
      tip = { x: xy[i].x + (xy[i + 1].x - xy[i].x) * r, y: xy[i].y + (xy[i + 1].y - xy[i].y) * r };
      break;
    }
    remaining -= segLengths[i];
    tip = xy[i + 1];
  }

  const latest = points[points.length - 1];
  const latestOpacity = interpolate(frame, [drawEnd, drawEnd + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const gridValues = [max - pad, (max + min) / 2, min + pad];

  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 190, opacity: fadeIn }}>
      <div
        style={{
          width: PANEL_WIDTH,
          background: "rgba(8, 12, 24, 0.86)",
          borderRadius: 28,
          padding: "36px 50px 30px",
          boxSizing: "border-box",
          fontFamily,
          color: "white",
        }}
      >
        <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.2 }}>{chart.title}</div>
        <div style={{ fontSize: 30, color: "#B8C4D8", marginTop: 8 }}>
          {chart.label}
          {unit ? `(${unit})` : ""}
        </div>
        <svg width={PLOT_WIDTH} height={PLOT_HEIGHT + 60} style={{ marginTop: 28, overflow: "visible" }}>
          {gridValues.map((v, i) => {
            const y = PLOT_HEIGHT - ((v - min) / (max - min)) * PLOT_HEIGHT;
            return (
              <g key={i}>
                <line x1={0} x2={PLOT_WIDTH} y1={y} y2={y} stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
                <text x={0} y={y - 10} fill="#8C99B0" fontSize={26} fontFamily={fontFamily}>
                  {formatValue(v, decimals, "")}
                </text>
              </g>
            );
          })}
          <path
            d={d}
            fill="none"
            stroke="#FFD400"
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={totalLength}
            strokeDashoffset={totalLength * (1 - progress)}
          />
          <circle cx={tip.x} cy={tip.y} r={13} fill="#FFD400" />
          <text x={0} y={PLOT_HEIGHT + 48} fill="#8C99B0" fontSize={28} fontFamily={fontFamily}>
            {formatDate(points[0].t)}
          </text>
          <text x={PLOT_WIDTH} y={PLOT_HEIGHT + 48} fill="#8C99B0" fontSize={28} fontFamily={fontFamily} textAnchor="end">
            {formatDate(latest.t)}
          </text>
        </svg>
        <div
          style={{
            opacity: latestOpacity,
            fontSize: 44,
            fontWeight: 700,
            color: "#FFD400",
            textAlign: "right",
            marginTop: 6,
          }}
        >
          最新 {formatValue(latest.v, decimals, unit)}
        </div>
        <div style={{ fontSize: 24, color: "#8C99B0", textAlign: "right", marginTop: 8 }}>{chart.source}</div>
      </div>
    </AbsoluteFill>
  );
};
