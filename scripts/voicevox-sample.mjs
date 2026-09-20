import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const BASE = "http://127.0.0.1:50021";
const SPEED_SCALE = 1.15; // 現行のGoogle TTS(speakingRate 1.15)と速度をそろえて比較する
const CANDIDATE_NAMES = [
  "青山龍星",
  "玄野武宏",
  "白上虎太郎",
  "冥鳴ひまり",
  "四国めたん",
  "春日部つむぎ",
  "波音リツ",
  "雨晴はう",
  "九州そら",
  "剣崎雌雄",
  "ずんだもん",
];

const script = JSON.parse(fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8"));
const byId = Object.fromEntries(script.segments.map((s) => [s.id, s.narration]));
const text = [byId.hook, byId.rank3].filter(Boolean).join("");
console.log(`サンプル文(${text.length}字): ${text}`);

const speakers = await (await fetch(`${BASE}/speakers`)).json();
const outDir = path.join(root, "out", "voicevox-samples");
fs.mkdirSync(outDir, { recursive: true });

const allList = speakers
  .map((sp) => `${sp.name}: ${sp.styles.map((st) => `${st.name}(id=${st.id})`).join(", ")}`)
  .join("\n");
fs.writeFileSync(path.join(outDir, "speakers-all.txt"), allList);
console.log("--- 利用可能な全話者 ---\n" + allList);

const index = [];
for (const name of CANDIDATE_NAMES) {
  const sp = speakers.find((s) => s.name === name);
  if (!sp) {
    console.log(`(スキップ) ${name} は見つかりませんでした`);
    continue;
  }
  const style = sp.styles.find((st) => st.name === "ノーマル") ?? sp.styles[0];
  const q = await (
    await fetch(`${BASE}/audio_query?speaker=${style.id}&text=${encodeURIComponent(text)}`, { method: "POST" })
  ).json();
  q.speedScale = SPEED_SCALE;
  const res = await fetch(`${BASE}/synthesis?speaker=${style.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(q),
  });
  if (!res.ok) {
    console.log(`(失敗) ${name}: ${res.status} ${await res.text()}`);
    continue;
  }
  const file = `sample_${String(style.id).padStart(3, "0")}.wav`;
  fs.writeFileSync(path.join(outDir, file), Buffer.from(await res.arrayBuffer()));
  index.push(`${file} = ${name}(${style.name})`);
  console.log(`OK: ${file} = ${name}(${style.name})`);
}
fs.writeFileSync(path.join(outDir, "index.txt"), index.join("\n"));
