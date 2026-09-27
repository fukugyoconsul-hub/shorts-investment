import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchRelated } from "./main-video-match.mjs";

// 今回の台本に関連するメインチャンネルの動画を選び、latest-script.jsonに書き込む(概要欄・コメントで誘導する)。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const scriptPath = path.join(root, "content", "latest-script.json");

const script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
const result = await matchRelated([{ key: "current", title: script.title, topics: script.topics }]);
script.relatedMainVideo = result.current;
fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
console.log(
  result.current
    ? `OK: 関連するメインチャンネル動画: ${result.current.title} (${result.current.id})`
    : "関連するメインチャンネル動画はありませんでした"
);
