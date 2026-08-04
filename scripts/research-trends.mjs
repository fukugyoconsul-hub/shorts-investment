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
const genreNames = categories.map((c) => c.name).join("、");

const prompt = `あなたはYouTube Shorts市場調査の専門家です。Web検索を使って、直近1〜2週間で日本語圏で伸びているFX・投資・金融教育系YouTube Shortsに共通する「構造的なパターン」と「よく伸びているテーマ・切り口の傾向」を調査してください。

# 調査対象の絞り込み
うちのチャンネルは顔出し・声出しなしで、相場初心者向けの金融・投資リテラシー教育を目的とし、FX・テクニカル分析・ファンダメンタルズ分析・CFD取引をメイン、株式・コモディティ・債券・金融・日本経済・世界情勢をサブに扱っています(現在の全ジャンル: ${genreNames})。これに近い、ナレーション+シンプルな背景映像だけで成立する教育系動画を対象に調査してください。

# 調査すべき観点(2種類)

## A. 構造パターン(タイトル・フック・構成の「型」)
- タイトルの型(疑問形/断定形/数字型/「〜とは」型など)で、今伸びやすいもの
- 冒頭フックの作り方(最初の1〜2秒でどう惹きつけているか)
- 構成の型(用語解説形式/ランキング形式、どちらが今伸びやすい傾向にあるか)

## B. テーマ・内容の傾向
- 今、初心者向け金融教育コンテンツでよく再生されている切り口(例:身近な物価上昇と金利の関係、円安のニュースをきっかけにした為替の仕組み解説など)
- うちの既存ジャンル(${genreNames})それぞれについて、今特に反応が良さそうな切り口があれば挙げる

# 【最重要・絶対禁止事項】投資系チャンネル特有の制約
- 具体的な売買タイミングの示唆、個別銘柄・通貨ペアの推奨、将来価格の予測、利益を保証する表現につながるようなテーマ・パターンは絶対に提案しないこと
- あくまで「一般的な仕組みの解説」「公的統計・歴史的事実の紹介」として成立する切り口のみを対象にすること

# 重要な制約(著作権配慮)
特定の動画の台本・セリフ・ナレーション文言をそのまま書き写さないこと(構造パターンのexampleも、テーマのexampleも、実在動画の引用ではなく一般化した例にすること)。抽象度の高い「一般的なテーマ・題材のカテゴリ」を報告すること自体は問題ない。

# 出力JSON形式(このスキーマに厳密に従うこと。説明文やコードフェンスは一切つけず、JSONのみ出力)
{
  "patterns": [
    { "pattern": "パターン名(短い名前)", "description": "何がなぜ効果的なのかの説明(1〜2文)", "example": "抽象化した一般的な例(実在動画の引用ではない)" }
  ],
  "themes": [
    { "theme": "テーマ名(短い名前)", "description": "なぜ今反応が良いのかの説明(1〜2文)", "relatedGenre": "最も近い既存ジャンル名(なければ空文字)" }
  ],
  "summary": "全体的な傾向のまとめ(1〜2文)"
}`;

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
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`JSONが見つかりませんでした。出力: ${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

console.log("トレンドパターンを調査中...");
const raw = await runClaude(prompt);
const result = extractJson(raw);

if (!Array.isArray(result.patterns) || result.patterns.length === 0) {
  console.error("有効なパターンが得られませんでした。今回は更新をスキップします");
  process.exit(0);
}

const output = {
  patterns: result.patterns.slice(0, 5),
  themes: Array.isArray(result.themes) ? result.themes.slice(0, 5) : [],
  summary: result.summary ?? "",
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(root, "content", "trend-insights.json"),
  JSON.stringify(output, null, 2)
);

console.log(`OK: ${output.patterns.length}件のパターン・${output.themes.length}件のテーマを content/trend-insights.json に保存しました`);
output.patterns.forEach((p) => console.log(`  - [型] ${p.pattern}: ${p.description}`));
output.themes.forEach((t) => console.log(`  - [テーマ] ${t.theme}: ${t.description}`));
