import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return {};
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

const env = { ...process.env, ...loadEnv() };
if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error("CLAUDE_CODE_OAUTH_TOKEN が見つかりません");
  process.exit(1);
}

const categoriesPath = path.join(root, "scripts", "categories.json");
const categories = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));
const existingNames = categories.map((c) => c.name).join("、");

const prompt = `あなたはYouTubeショートの企画リサーチャーです。今、短尺動画(YouTube Shorts)で伸びやすい「FX・投資・金融・経済」系の教育コンテンツのジャンル・切り口を調査し、新しいジャンル候補を最大2個、JSON配列だけで出力してください。説明文やコードフェンス(\`\`\`)は一切つけず、JSONのみを出力してください。Web検索が使えるなら、実際に最近伸びている短尺動画の傾向を調べた上で提案してください。

# チャンネルの位置づけ
このチャンネルは「相場初心者の金融・投資リテラシーを高めること」が目的の教育系チャンネルであり、投資の勧誘・助言を行うものではない。メインジャンルはFX・テクニカル分析・ファンダメンタルズ分析・CFD取引、サブジャンルは株式・コモディティ・債券などFX以外の投資、金融、日本経済、世界情勢、時事ニュース。

# 既存のジャンル(これらとは違う新しいものを提案すること)
${existingNames}

# 新ジャンル候補の絶対条件
- 「今買うべき」「今が売り時」等、具体的な売買タイミングの示唆や、個別の金融商品の売買推奨につながるジャンルは絶対禁止
- 将来の価格・値動きの予測や、利益を保証・断定するような切り口は絶対禁止
- 実在の人物(有名なアナリスト・トレーダー・インフルエンサー等)の実名・私生活・個人の投資成績を扱う内容は絶対禁止
- 著作権のあるキャラクター・作品への言及や、それらに基づくランキングは絶対禁止
- 特定の金融機関・証券会社・取引所・暗号資産取引所を推奨または批判する内容は禁止
- あくまで一般的な仕組み・用語・公的統計・過去の事実の解説として成立する内容にすること
- ナレーション(音声)とシンプルな背景動画だけで成立する内容にすること(実写の人物出演やアニメーション制作が必須なものは不可)

# fictionフィールドについて
- 投資系チャンネルでは創作要素は不適切なため、常に fiction: false にすること

# formatフィールドについて
- kaisetsu: 「〜とは?」を基礎→仕組み→注意点の順で解説する形式(用語・制度の解説向け)
- qa: 問いかけ→結論の形式(なぜ〜なのか、を解き明かす内容向け)
- ranking: ベスト3形式(歴史的な事実・雑学の紹介向け)
- simulation: 「もし〜だったら」の思考実験形式(スケール感のある思考実験向け)

# nameの命名ルール(重要)
- nameは「FX」「株式」「日本経済」のように、2〜5文字程度の単語1つだけにすること
- 「の」「・」「と」などの接続詞・助詞や、長い説明的なフレーズは絶対に使わないこと
- 詳しい内容の説明はnameではなくbriefに書くこと

# 出力JSON形式(このスキーマに厳密に従うこと。既存ジャンルと同じ形)
[
  {
    "name": "ジャンル名(上記の命名ルールに従った短い単語1つ)",
    "brief": "台本作家への指示となる説明文。何を扱うか、何を避けるべきかを具体的に(投資助言・売買タイミングの示唆を避けるべき旨を必ず明記すること)",
    "format": "kaisetsu・qa・ranking・simulationのいずれか",
    "fiction": false
  }
]`;

function runClaude(promptText) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p が失敗しました (code ${code}): ${stderr}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(promptText);
    child.stdin.end();
  });
}

function extractJson(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error(`JSON配列が見つかりませんでした。出力: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

console.log("新ジャンルをリサーチ中...");
const raw = await runClaude(prompt);
const candidates = extractJson(raw);

let added = 0;
for (const c of candidates) {
  if (!c.name || !c.brief || !["kaisetsu", "qa", "ranking", "simulation"].includes(c.format)) {
    console.log(`スキップ(形式が不正): ${JSON.stringify(c)}`);
    continue;
  }
  if (categories.some((existing) => existing.name === c.name)) {
    console.log(`スキップ(既存と重複): ${c.name}`);
    continue;
  }
  // 投資系チャンネルでは常にfiction: falseに固定する(候補側の値に関わらず上書き)
  categories.push({ name: c.name, brief: c.brief, format: c.format, fiction: false, displayGenre: c.name });
  added++;
  console.log(`追加: ${c.name} (${c.format})`);
}

if (added > 0) {
  fs.writeFileSync(categoriesPath, JSON.stringify(categories, null, 2));
  console.log(`OK: ${added}件の新ジャンルを categories.json に追加しました`);
} else {
  console.log("新しく追加されたジャンルはありませんでした");
}
