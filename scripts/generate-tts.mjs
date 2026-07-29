import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env");
  const text = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const env = loadEnv();
const apiKey = env.GOOGLE_TTS_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_TTS_API_KEY が .env に見つかりません");
  process.exit(1);
}

// ナレーターの声質は動画ごとにランダムに変える(キャラクター設定:ランダム)。
// ただし読み上げ速度(speakingRate)は聞きやすさ・一貫性のため全ボイス共通で固定する。
const VOICE_POOL = [
  "ja-JP-Chirp3-HD-Aoede",
  "ja-JP-Chirp3-HD-Kore",
  "ja-JP-Chirp3-HD-Leda",
  "ja-JP-Chirp3-HD-Autonoe",
  "ja-JP-Chirp3-HD-Charon",
  "ja-JP-Chirp3-HD-Fenrir",
  "ja-JP-Chirp3-HD-Puck",
  "ja-JP-Chirp3-HD-Algenib",
];
const SPEAKING_RATE = 1.15;

const voiceName = VOICE_POOL[Math.floor(Math.random() * VOICE_POOL.length)];
console.log(`ナレーターボイス: ${voiceName}`);

const scriptPath = path.join(root, "content", "latest-script.json");
const latestScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
const segments = latestScript.segments.map((s) => ({ id: s.id, text: s.narration }));

const outDir = path.join(root, "public", "audio");
fs.mkdirSync(outDir, { recursive: true });

async function synthesize(segment) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: segment.text },
        voice: { languageCode: "ja-JP", name: voiceName },
        audioConfig: { audioEncoding: "MP3", speakingRate: SPEAKING_RATE },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[${segment.id}] TTS API エラー (${res.status}): ${body}`);
  }

  const json = await res.json();
  const buffer = Buffer.from(json.audioContent, "base64");
  const outPath = path.join(outDir, `${segment.id}.mp3`);
  fs.writeFileSync(outPath, buffer);
  console.log(`OK: ${outPath}`);
}

for (const segment of segments) {
  await synthesize(segment);
}

console.log("すべてのナレーション音声を生成しました。");
