import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "http://127.0.0.1:50021";

function wavDurationSec(buf) {
  const byteRate = buf.readUInt32LE(28);
  const dataIdx = buf.indexOf("data", 12, "latin1");
  return (buf.length - (dataIdx + 8)) / byteRate;
}

const script = JSON.parse(fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8"));
const texts = script.segments.map((s) => s.narration);
const totalChars = texts.join("").length;
console.log(`台本: ${script.title} / 合計${totalChars}字 / ${texts.length}セグメント`);

const apiKey = process.env.GOOGLE_TTS_API_KEY;
console.log("\n=== 現行(Google TTS, speakingRate 1.15) ===");
const googleCps = [];
for (const voice of ["Leda", "Kore", "Puck", "Charon"]) {
  let total = 0;
  for (const t of texts) {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: t },
        voice: { languageCode: "ja-JP", name: `ja-JP-Chirp3-HD-${voice}` },
        audioConfig: { audioEncoding: "LINEAR16", speakingRate: 1.15 },
      }),
    });
    if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
    total += wavDurationSec(Buffer.from((await res.json()).audioContent, "base64"));
  }
  const cps = totalChars / total;
  googleCps.push(cps);
  console.log(`${voice}: 音声${total.toFixed(1)}秒 → ${cps.toFixed(2)}字/秒`);
}
console.log(`Google平均: ${(googleCps.reduce((a, b) => a + b, 0) / googleCps.length).toFixed(2)}字/秒`);

console.log("\n=== VOICEVOX(speedScale 1.0) ===");
const speakers = await (await fetch(`${BASE}/speakers`)).json();
for (const name of ["青山龍星", "玄野武宏", "白上虎太郎", "冥鳴ひまり", "四国めたん", "春日部つむぎ", "波音リツ", "雨晴はう", "九州そら", "剣崎雌雄", "ずんだもん"]) {
  const sp = speakers.find((s) => s.name === name);
  if (!sp) continue;
  const style = sp.styles.find((st) => st.name === "ノーマル") ?? sp.styles[0];
  let total = 0;
  for (const t of texts) {
    const q = await (await fetch(`${BASE}/audio_query?speaker=${style.id}&text=${encodeURIComponent(t)}`, { method: "POST" })).json();
    const res = await fetch(`${BASE}/synthesis?speaker=${style.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q),
    });
    total += wavDurationSec(Buffer.from(await res.arrayBuffer()));
  }
  console.log(`${name}: 音声${total.toFixed(1)}秒 → ${(totalChars / total).toFixed(2)}字/秒`);
}
