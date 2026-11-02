import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadExperiment() {
  return JSON.parse(fs.readFileSync(path.join(root, "scripts", "experiment.json"), "utf-8"));
}

// 投稿枠ごとの割り当て。毎日新旧を1本ずつにし、2日ごとの組の中で新型の枠を8時と16時で入れ替える
// (どちらが先かは組ごとにランダム)。8時の枠のほうが再生されやすいので、枠の偏りをなくすため。
// 投稿時刻だけで再現できるため、記録(used-topics.json)が欠けても後から割り当てを復元できる。
// 通常の投稿枠(JST 8:00 / 16:00)以外は null(テスト対象外)。
export function assignVariant(slotIso, experiment = loadExperiment()) {
  if (!experiment.active || !slotIso) return null;
  const jst = new Date(new Date(slotIso).getTime() + 9 * 3600 * 1000);
  const hour = jst.getUTCHours();
  if (hour !== 8 && hour !== 16) return null;
  const dayNumber = Math.floor(jst.getTime() / 86400000);
  const block = Math.floor(dayNumber / 2);
  const firstByte = crypto.createHash("sha256").update(`${experiment.id}:${block}`).digest()[0];
  const firstDayNewHour = firstByte % 2 === 0 ? 8 : 16;
  const isFirstDay = dayNumber % 2 === 0;
  const newHour = isFirstDay ? firstDayNewHour : firstDayNewHour === 8 ? 16 : 8;
  return hour === newHour ? "new" : "old";
}
