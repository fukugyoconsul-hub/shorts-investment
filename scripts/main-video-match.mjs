import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ショート動画の内容と関連するメインチャンネル(TACテクニカル分析講座)の動画を選ぶ共通処理。
// content/main-channel-videos.json(fetch-main-channel-videos.mjsが週次で更新)を候補にする。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const text = fs.readFileSync(path.join(root, ".env"), "utf-8");
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

function runClaude(promptText) {
  const env = loadEnv();
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude -p が失敗しました (code ${code}): ${stderr}`));
      resolve(stdout);
    });
    child.stdin.write(promptText);
    child.stdin.end();
  });
}

// 誘導先から外す動画。ショート側の台本ルール(利益を保証する表現の禁止・特定業者を推奨しない)と
// 矛盾する誘導は、視聴者の誤解やYPP審査での不利につながるため。
// 対象: 特定の業者・口座・アプリの紹介、成果を保証するような手法、バイナリーオプション、投資と無関係な動画。
const EXCLUDE_TITLE_RE =
  /IUX|BigBoss|OMEGA|ハビットトレード|Habit ?Trade|ブローカー|口座|勝率\d+|聖杯|稼げる|バイナリー|ブビンガ|ボブ・サップ|破壊王/;

export function loadMainVideos() {
  const all = JSON.parse(fs.readFileSync(path.join(root, "content", "main-channel-videos.json"), "utf-8"));
  return all.filter((v) => !EXCLUDE_TITLE_RE.test(v.title));
}

// items: [{ key, title, topics }] → { [key]: { id, title } | null }
export async function matchRelated(items) {
  const mainVideos = loadMainVideos();
  const byId = new Map(mainVideos.map((v) => [v.id, v]));
  const candidates = mainVideos.map((v) => `${v.id}\t${v.title}`).join("\n");
  const targets = items
    .map((it) => `${it.key}\t${it.title}${it.topics?.length ? `(${it.topics.join("/")})` : ""}`)
    .join("\n");

  const prompt = `あなたはYouTubeチャンネル運営のアシスタントです。
投資・金融の教育系ショート動画ごとに、同じ運営者のメインチャンネル「TACテクニカル分析講座」(FX・テクニカル分析・トレード手法の解説)の動画の中から、視聴者を誘導するのに最も関連性の高い動画を1本だけ選んでください。

# 選び方
- テーマ・用語・扱う金融商品・関連する概念など、少しでも内容的なつながりがあれば選ぶ(例: 為替・金利・経済指標の話 → FXの解説動画、チャートの話 → テクニカル分析の解説動画)
- 候補の中で最もつながりが強いものを選ぶ。同程度なら長尺の解説動画(タイトルに#shortsが無いもの)と新しい動画を優先する
- 投資・金融と無関係な動画(格闘技など)は絶対に選ばない
- つながりが全く見いだせない場合のみ null にする

# メインチャンネルの動画候補(動画ID<TAB>タイトル)
${candidates}

# 対象のショート動画(キー<TAB>タイトル(内容))
${targets}

# 出力
説明文やコードフェンスは付けず、次の形式のJSONのみを出力すること。キーは対象のショート動画のキーをそのまま使う。
{"キー1": "選んだ動画ID または null", "キー2": "..."}`;

  const raw = await runClaude(prompt);
  const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  const result = {};
  for (const it of items) {
    const id = json[it.key];
    const v = id ? byId.get(id) : null;
    result[it.key] = v ? { id: v.id, title: v.title } : null;
  }
  return result;
}

export function relatedSection(related) {
  return `▼この動画に関連する解説はメインチャンネルで！\n${related.title}\nhttps://www.youtube.com/watch?v=${related.id}`;
}
