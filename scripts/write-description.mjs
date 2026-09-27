import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { relatedSection } from "./main-video-match.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);
const { creditLine } = JSON.parse(
  fs.readFileSync(path.join(root, "content", "current-bgm-credit.json"), "utf-8")
);
const { creditLine: voiceCreditLine } = JSON.parse(
  fs.readFileSync(path.join(root, "content", "current-voice-credit.json"), "utf-8")
);
const template = fs.readFileSync(path.join(root, "description-template.txt"), "utf-8");

const CORE_TAGS = ["FX", "テクニカル分析", "ファンダメンタルズ分析", "shorts"];
const GENERIC_WORDS = new Set([...CORE_TAGS, "投資", "資産運用", "初心者", "マネーリテラシー"]);

// SEO対策として、動画固有の検索キーワードを5つ程度、固定タグに追加する
const extraTags = (latestScript.tags ?? [])
  .filter((t) => !GENERIC_WORDS.has(t))
  .slice(0, 5);

const hashtags = [...CORE_TAGS, ...extraTags].map((t) => `#${t}`).join(" ");

// 関連するメインチャンネル動画があれば、冒頭の1文の直後(独立した段落)に誘導を入れる。
// auto-retry-seo.mjsは冒頭の段落だけを書き換えるので、この段落は残る。
const related = latestScript.relatedMainVideo
  ? `${relatedSection(latestScript.relatedMainVideo)}\n\n`
  : "";

const description = `${latestScript.descriptionHook}\n\n${related}${template
  .replace("{{VOICE_CREDIT}}", voiceCreditLine)
  .replace("{{MUSIC_CREDIT}}", creditLine)
  .replace("{{HASHTAGS}}", hashtags)}`;

fs.writeFileSync(path.join(root, "description.txt"), description);
fs.writeFileSync(
  path.join(root, "content", "current-hashtags.json"),
  JSON.stringify({ hashtags }, null, 2)
);
console.log(`OK: description.txt を更新しました(タグ: ${hashtags})`);
