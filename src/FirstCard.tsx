import { AbsoluteFill } from "remotion";

const MAX_CHARS_PER_LINE = 9;

// 語の途中で折り返さないように、1行あたりの文字数に収まるところで改行する
function wrapLine(text: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segmenter = new (Intl as any).Segmenter("ja", { granularity: "word" });
  const lines: string[] = [];
  let current = "";
  for (const { segment } of Array.from(segmenter.segment(text)) as { segment: string }[]) {
    if (current && current.length + segment.length > MAX_CHARS_PER_LINE) {
      lines.push(current);
      current = "";
    }
    current += segment;
  }
  if (current) lines.push(current);
  return lines;
}

// 案1テストの新型: 冒頭の2秒だけ、テーマを上部に大きく出す(1コマ目から表示)。
export const FirstCard: React.FC<{ lines: string[]; fontFamily: string }> = ({ lines, fontFamily }) => {
  const wrapped = lines.reduce<string[]>((all, line) => all.concat(wrapLine(line)), []);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 300 }}>
      <div
        style={{
          width: 960,
          boxSizing: "border-box",
          padding: "44px 30px",
          background: "rgba(0,0,0,0.72)",
          borderRadius: 28,
          textAlign: "center",
          fontFamily,
          fontWeight: 700,
          fontSize: 100,
          lineHeight: 1.25,
          color: "white",
        }}
      >
        {wrapped.map((line, i) => (
          <div key={i} style={{ color: i < wrapped.length / 2 ? "#FFD400" : "white" }}>
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
