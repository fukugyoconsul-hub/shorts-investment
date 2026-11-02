// 概要欄のハッシュタグを作る。YouTubeは「動画と直接関係のないハッシュタグ」を動画削除の原因になると
// 定めているので、FXやテクニカル分析などのタグは、そのジャンルの動画にだけ付ける。
const TAGS_BY_CATEGORY = {
  FX: ["FX"],
  為替介入: ["FX"],
  テクニカル: ["テクニカル分析"],
  ファンダメンタルズ: ["ファンダメンタルズ分析"],
  経済指標: ["ファンダメンタルズ分析"],
  中央銀行: ["ファンダメンタルズ分析"],
};
const FIXED_TAGS = ["FX", "テクニカル分析", "ファンダメンタルズ分析"];
const EXCLUDED_EXTRA_TAGS = new Set([...FIXED_TAGS, "shorts", "投資", "資産運用", "初心者", "マネーリテラシー"]);
// FXの動画でないのに付いている「#FX初心者」なども無関係なので外す対象にする
const FX_CATEGORIES = new Set(["FX", "為替介入", "テクニカル", "CFD"]);
// ジャンルの記録がない古い動画は、タイトルから判断する
const FX_TITLE = /FX|為替|ドル円|円安|円高|pips|スプレッド|レバレッジ|スワップ/i;
const TECHNICAL_TITLE = /テクニカル|ローソク足|移動平均|RSI|MACD|ボリンジャー|一目均衡|フィボナッチ/i;

export function buildHashtags(category, tags) {
  const extraTags = (tags ?? []).filter((t) => !EXCLUDED_EXTRA_TAGS.has(t)).slice(0, 5);
  return [...(TAGS_BY_CATEGORY[category] ?? []), "shorts", ...extraTags].map((t) => `#${t}`).join(" ");
}

// 投稿済みの動画の概要欄の最後のハッシュタグ行から、内容と関係ないタグだけを取り除く。他の部分は変えない。
export function fixHashtagLine(description, category, title) {
  const lastBreak = description.trimEnd().lastIndexOf("\n");
  const line = description.trimEnd().slice(lastBreak + 1);
  if (!line.startsWith("#")) return description;

  const allowed = new Set(TAGS_BY_CATEGORY[category] ?? []);
  const fxRelated = category ? FX_CATEGORIES.has(category) : FX_TITLE.test(title);
  if (!category) {
    if (fxRelated) allowed.add("FX");
    if (TECHNICAL_TITLE.test(title)) allowed.add("テクニカル分析");
  }
  const kept = line.split(/\s+/).filter((tag) => {
    const name = tag.slice(1);
    if (FIXED_TAGS.includes(name)) return allowed.has(name);
    if (name.startsWith("FX")) return fxRelated;
    return true;
  });
  return description.slice(0, lastBreak + 1) + kept.join(" ");
}
