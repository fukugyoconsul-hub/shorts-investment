import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { relatedSection } from "./main-video-match.mjs";
import { buildHashtags } from "./hashtags.mjs";

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

const hashtags = buildHashtags(latestScript.category, latestScript.tags);

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
