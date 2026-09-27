import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 時事に連動したテーマ選びのため、直近の経済ニュースの見出しを取得する(Googleニュースのビジネス面と金融キーワード検索)。
// 見出しは「話題の切り口」としてのみ台本生成に渡す(記事の読み上げはしない)。失敗しても動画作成は止めない。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = path.join(root, ".cache", "news.json");
const MAX_AGE_DAYS = 3;
const MAX_ITEMS = 25;

const FEEDS = [
  "https://news.google.com/rss/topics/CAAqIggKIhxDQkFTRHdvSkwyMHZNR2RtY0hNekVnSnFZU2dBUAE?hl=ja&gl=JP&ceid=JP:ja",
  `https://news.google.com/rss/search?q=${encodeURIComponent("為替 OR 日銀 OR FRB OR 株価 OR 金利 OR 物価 OR 原油 when:3d")}&hl=ja&gl=JP&ceid=JP:ja`,
];

function decode(s) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
const seen = new Set();
const items = [];
for (const url of FEEDS) {
  try {
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).text();
    for (const m of xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)) {
      const published = new Date(decode(m[2]));
      // 見出し末尾の「 - 媒体名」を落とし、株価ページなどニュースではないものは除く
      const title = decode(m[1]).replace(/\s+-\s+[^-]+$/, "");
      if (!(published.getTime() >= cutoff) || seen.has(title)) continue;
      // 特定銘柄・商品のおすすめ記事は、台本の安全ルール(特定商品を推奨しない)と相性が悪いので切り口に使わない
      if (/株価・株式情報|指数情報・推移|チャート・時系列|おすすめ|オススメ|厳選|狙い目/.test(title)) continue;
      seen.add(title);
      items.push({ title, publishedAt: published.toISOString() });
    }
  } catch (err) {
    console.error(`スキップ: ニュースの取得に失敗しました(${url}): ${err.message}`);
  }
}

items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), items: items.slice(0, MAX_ITEMS) }, null, 2));
console.log(`OK: ニュース見出し${Math.min(items.length, MAX_ITEMS)}件を保存しました`);
