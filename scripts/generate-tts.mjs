import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const BASE = process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021";

// ナレーターの声質は動画ごとにランダムに変える(キャラクター設定:ランダム)。
// 各キャラの利用規約(エンジンのspeaker_infoと各公式規約ページ原文)を確認済みの声のみ入れること。
// 投資系チャンネルで概要欄に情報商材系アフィリエイトを含むため、規約で「情報商材での利用NG」の
// ずんだもん・四国めたん・九州そらは使わない。青山龍星は企業関与時に事前確認が必要なため除外。
const VOICE_POOL = ["玄野武宏", "白上虎太郎", "雨晴はう", "冥鳴ひまり"];

// 従来(Google TTS speakingRate 1.15)の実測の読み上げ速さ: 約6.35字/秒。
// 声ごとに素の速さが違うため、毎回この速さになるようにspeedScaleを自動調整する。
const TARGET_CHARS_PER_SEC = 6.35;
const SPEED_MIN = 0.9;
const SPEED_MAX = 1.6;

function wavDurationSec(buf) {
  const byteRate = buf.readUInt32LE(28);
  const dataIdx = buf.indexOf("data", 12, "latin1");
  return (buf.length - (dataIdx + 8)) / byteRate;
}

async function api(pathAndQuery, init) {
  const res = await fetch(`${BASE}${pathAndQuery}`, init);
  if (!res.ok) {
    throw new Error(`VOICEVOX API エラー (${res.status}) ${pathAndQuery}: ${await res.text()}`);
  }
  return res;
}

const speakers = await (await api("/speakers")).json();
const voiceName = VOICE_POOL[Math.floor(Math.random() * VOICE_POOL.length)];
const speaker = speakers.find((s) => s.name === voiceName);
if (!speaker) {
  throw new Error(`VOICEVOXエンジンに話者「${voiceName}」が見つかりません`);
}
const style = speaker.styles.find((st) => st.name === "ノーマル" || st.name === "ふつう") ?? speaker.styles[0];
console.log(`ナレーターボイス: ${voiceName}(${style.name}, id=${style.id})`);

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);
const segments = latestScript.segments.map((s) => ({ id: s.id, text: s.narration }));

const queries = [];
for (const segment of segments) {
  const res = await api(
    `/audio_query?speaker=${style.id}&text=${encodeURIComponent(segment.text)}`,
    { method: "POST" }
  );
  queries.push(await res.json());
}

async function synthesize(query, speedScale) {
  const res = await api(`/synthesis?speaker=${style.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...query, speedScale }),
  });
  return Buffer.from(await res.arrayBuffer());
}

// 1回目: 標準速度で全セグメントの長さを測り、目標の速さになるspeedScaleを決める
let baseDuration = 0;
for (const q of queries) {
  baseDuration += wavDurationSec(await synthesize(q, 1.0));
}
const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);
const speedScale = Math.min(
  SPEED_MAX,
  Math.max(SPEED_MIN, (baseDuration * TARGET_CHARS_PER_SEC) / totalChars)
);
console.log(
  `標準速度の読み上げ: ${baseDuration.toFixed(1)}秒 / ${totalChars}字 → speedScale=${speedScale.toFixed(3)}`
);

const outDir = path.join(root, "public", "audio");
fs.mkdirSync(outDir, { recursive: true });

let finalDuration = 0;
for (let i = 0; i < segments.length; i++) {
  const wav = await synthesize(queries[i], speedScale);
  finalDuration += wavDurationSec(wav);
  const outPath = path.join(outDir, `${segments[i].id}.wav`);
  fs.writeFileSync(outPath, wav);
  console.log(`OK: ${outPath}`);
}
console.log(
  `すべてのナレーション音声を生成しました。合計${finalDuration.toFixed(1)}秒(${(totalChars / finalDuration).toFixed(2)}字/秒)`
);

// 概要欄に自動で記載するクレジット表記(VOICEVOXの規約で必須)
fs.writeFileSync(
  path.join(root, "content", "current-voice-credit.json"),
  JSON.stringify({ creditLine: `VOICEVOX:${voiceName}` }, null, 2)
);
