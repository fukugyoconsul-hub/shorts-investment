import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignVariant } from "./first-card-test.mjs";

// この動画が案1テストの新型か旧型かを決め、動画の描画用(src/first-card.ts)と台本の記録に書き出す。
// テスト対象外の投稿枠やテスト終了後は旧型のまま(記録はnull)。必ず書き直すので前回の値は残らない。
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const assigned = process.env.FIRST_CARD_FORCE || assignVariant(process.env.TARGET_PUBLISH_AT);

fs.writeFileSync(
  path.join(root, "src", "first-card.ts"),
  `export const firstCardVariant: "new" | "old" = ${JSON.stringify(assigned === "new" ? "new" : "old")};\n`
);

const scriptPath = path.join(root, "content", "latest-script.json");
const script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
script.firstCardVariant = assigned;
fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
console.log(`OK: 冒頭の型 = ${assigned ?? "テスト対象外(旧型)"}`);
