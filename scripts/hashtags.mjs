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
const EXCLUDED_EXTRA_TAGS = new Set(["FX", "テクニカル分析", "ファンダメンタルズ分析", "shorts", "投資", "資産運用", "初心者", "マネーリテラシー"]);

export function buildHashtags(category, tags) {
  const extraTags = (tags ?? []).filter((t) => !EXCLUDED_EXTRA_TAGS.has(t)).slice(0, 5);
  return [...(TAGS_BY_CATEGORY[category] ?? []), "shorts", ...extraTags].map((t) => `#${t}`).join(" ");
}
