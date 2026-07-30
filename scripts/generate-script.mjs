import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const text = fs.readFileSync(path.join(root, ".env"), "utf-8");
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

const env = loadEnv();
if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error("CLAUDE_CODE_OAUTH_TOKEN が .env に見つかりません");
  process.exit(1);
}

const usedTopicsPath = path.join(root, "content", "used-topics.json");
const misreadingDictPath = path.join(root, "content", "misreading-dict.json");
const outputPath = path.join(root, "content", "latest-script.json");

const usedTopics = JSON.parse(fs.readFileSync(usedTopicsPath, "utf-8"));
const misreadingDict = JSON.parse(fs.readFileSync(misreadingDictPath, "utf-8"));

const usedTitlesList = usedTopics.map((t) => `- ${t.title}(${t.topics.join("/")})`).join("\n");
const misreadingList = Object.entries(misreadingDict)
  .map(([kanji, kana]) => `${kanji}→${kana}`)
  .join("、");

const categoriesPath = path.join(root, "scripts", "categories.json");
const CATEGORIES = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));

const categoryStatsPath = path.join(root, "content", "category-stats.json");
const categoryStats = fs.existsSync(categoryStatsPath)
  ? JSON.parse(fs.readFileSync(categoryStatsPath, "utf-8"))
  : {};

const retentionSummaryPath = path.join(root, "content", "retention-summary.json");
const retentionSummary = fs.existsSync(retentionSummaryPath)
  ? JSON.parse(fs.readFileSync(retentionSummaryPath, "utf-8"))
  : { overallRetentionPercentage: null };
const overallRetention = retentionSummary.overallRetentionPercentage;

// 過去の平均再生数が高いジャンルほど選ばれやすくする(ただし実績が無い/少ないジャンルにも
// 一定の確率を残し、開拓した新ジャンルが試される機会を確保する)。
// さらに、視聴維持率がチャンネル平均より高いジャンルは重みを増やし、低いジャンルは減らす
// (再生数だけだと初期のアルゴリズム的な偏りに引っ張られやすいが、視聴維持率はコンテンツの
// 質そのものを示すより安定した指標のため)。倍率は0.5〜2.0倍に制限してノイズの影響を抑える。
const BASELINE_WEIGHT = 30;
const weights = CATEGORIES.map((c) => {
  const stat = categoryStats[c.name];
  const avgViews = stat?.avgViews ?? 0;
  const retention = stat?.avgRetentionPercentage;
  const retentionMultiplier =
    retention != null && overallRetention
      ? Math.min(2, Math.max(0.5, retention / overallRetention))
      : 1;
  return avgViews * retentionMultiplier + BASELINE_WEIGHT;
});
const totalWeight = weights.reduce((a, b) => a + b, 0);
let pick = Math.random() * totalWeight;
let categoryIndex = 0;
for (let i = 0; i < weights.length; i++) {
  pick -= weights[i];
  if (pick <= 0) {
    categoryIndex = i;
    break;
  }
}
const category = CATEGORIES[categoryIndex];

const FORMAT_SPECS = {
  kaisetsu: {
    formatInstructions: `- フォーマット: フック(問いかけ、または「〜とは?」の提示)→基礎→仕組み→注意点→締め、の5パート構成(概念解説型)。badgeはすべてnullにする(順位表示はしない)
- rank3セグメントを「基礎」(用語の定義・全体像)、rank2セグメントを「仕組み」(具体的にどう機能するか)、rank1セグメントを「注意点」(誤解しやすい点・気をつけるべき点)として扱うこと`,
    titleInstructions:
      "動画タイトル(30字以内、「〜とは?」「〜の仕組み」のように、知りたくなる問いかけ・分かりやすい言い切りのもの)",
    topicsInstructions: "基礎/仕組み/注意点の一言要約",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "問いかけ・テーマ提示", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": null, "caption": ["...", "..."], "narration": "基礎(用語の定義・全体像)", "pexelsQuery": "..." },
    { "id": "rank2", "badge": null, "caption": ["...", "..."], "narration": "仕組み(具体的にどう機能するか)", "pexelsQuery": "..." },
    { "id": "rank1", "badge": null, "caption": ["...", "..."], "narration": "注意点(誤解しやすい点・気をつけるべき点)", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
  qa: {
    formatInstructions: `- フォーマット: フック(問いかけ)→振り1→振り2→結論(答え)→締め、の5パート構成(問いかけ→結論型)。badgeはすべてnullにする(順位表示はしない)
- フックは「〜って知っていますか?」「なぜ〜なのか知っていますか?」のような、視聴者に直接問いかける形にする
- rank3・rank2では、答えに関連する背景・事実を小出しにしながら期待を高める(答えをまだ明かさない)
- rank1で、意外性のある結論・理由を明快に明かす(ここが動画の核心)`,
    titleInstructions:
      "動画タイトル(30字以内、「〜な理由」「〜って知ってる?」のように、答えを知りたくなる問いかけ・断定調のもの)",
    topicsInstructions: "振り1/振り2/結論の一言要約",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "視聴者への問いかけ", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": null, "caption": ["...", "..."], "narration": "背景・事実1(答えはまだ明かさない)", "pexelsQuery": "..." },
    { "id": "rank2", "badge": null, "caption": ["...", "..."], "narration": "背景・事実2(期待を高める)", "pexelsQuery": "..." },
    { "id": "rank1", "badge": null, "caption": ["...", "..."], "narration": "意外性のある結論・理由を明かす", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
  ranking: {
    formatInstructions: `- フォーマット: フック→第3位→第2位→第1位→締め、の5パート構成(ランキング型)`,
    titleInstructions: "動画タイトル(30字以内、ベスト3形式が伝わる魅力的なもの)",
    topicsInstructions: "3位/2位/1位の一言要約",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "読み上げ文", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": "第3位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "rank2", "badge": "第2位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "rank1", "badge": "第1位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
  simulation: {
    formatInstructions: `- フォーマット: フック(極端な仮定を提示)→段階1→段階2→クライマックス、の5パート構成(シミュレーション仮説型)。badgeはすべてnullにする(順位表示はしない)
- 「もし〜だったら」のような、実在の経済的知見・史実に基づく思考実験にする。話が段階的にスケールアップしていく構成にする`,
    titleInstructions:
      "動画タイトル(30字以内、「もし〜だったら」のような極端な仮定が伝わる、事実に反しないキャッチーなもの)",
    topicsInstructions: "各段階の一言要約(3つ、話が進むにつれてスケールアップする)",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "極端な仮定を提示する読み上げ文", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": null, "caption": ["...", "..."], "narration": "段階1の説明", "pexelsQuery": "..." },
    { "id": "rank2", "badge": null, "caption": ["...", "..."], "narration": "段階2の説明(スケールアップ)", "pexelsQuery": "..." },
    { "id": "rank1", "badge": null, "caption": ["...", "..."], "narration": "クライマックス(最も極端な結末)", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
};

const spec = FORMAT_SPECS[category.format] ?? FORMAT_SPECS.kaisetsu;
const { formatInstructions, titleInstructions, topicsInstructions, segmentsExample } = spec;

// YouTube Analyticsの実測データ(視聴維持率)を踏まえた指示。維持率が低いほど、
// フックと情報密度をより強く指示する(track-performance.mjsが週次で更新する)
const retentionInstructions =
  overallRetention != null && overallRetention < 40
    ? `\n# 視聴維持率について(重要・実データに基づく指示)
直近の動画の平均視聴維持率は${overallRetention}%と低めです。最後まで見てもらえていません。今回は特に以下を徹底すること:
- フックの最初の1文だけで「え、なに」と思わせる、具体的な数字・意外な事実・断定的な一言を置く。「〜について紹介します」のような前置きは厳禁
- 各文の間延びを避け、1文ごとに新しい情報を必ず出す(既出情報の言い換え・繰り返しは禁止)
- rank3→rank2→rank1にかけて、意外性・インパクトが尻すぼみにならず右肩上がりになるようにする`
    : "";

const prompt = `あなたはYouTubeショート動画の台本作家です。FX・投資・金融の教育系チャンネル用に、新しい1本分の台本をJSON形式だけで出力してください。説明文やコードフェンス(\`\`\`)は一切つけず、JSONのみを出力してください。

# チャンネル設定
- チャンネルは「相場初心者の金融・投資リテラシーを高めること」が目的であり、投資の勧誘・助言を目的としていない
- ナレーター: 信頼感のある落ち着いたトーン(ナレーターの声質は動画ごとに変わるが、話し方の丁寧さ・情報密度は常に一定に保つこと)
${formatInstructions}
- 締めのセリフは必ず「チャンネル登録」を促す言葉を含める(「フォロー」ではなく「チャンネル登録」)

# 過去に使ったネタ(絶対に重複させないこと)
${usedTitlesList || "(まだありません)"}

# 今回のジャンル
${category.name}: ${category.brief}

# ネタの条件
- 上記ジャンルの範囲内で作ること。悩み相談・個別相談への誘導・アフィリエイト誘導は絶対に含めない
- 内容は、公的機関の統計・広く知られている経済的事実・一般的な金融の仕組みの解説に基づくこと(不確かな内容、誇張、将来予測の断定は避ける)
- 情報密度を高くすること。前置き・相槌・当たり障りのない一般論を削り、具体的な数字・用語・比較を積極的に使って、短い時間により多くの情報を詰め込む
- 各narrationは1〜2文で簡潔にしつつも、内容が薄くならないよう具体性を重視する
- 動画の尺は54〜59秒が目標。narration(読み上げ文)の合計文字数が320〜345字程度になるようにすること(目安: hook 50〜55字、rank3/rank2/rank1は各65〜85字、outroは50〜55字)。文字数が少なすぎても多すぎても尺がずれるので、この範囲を必ず守ること
- (視聴維持率対策・常時適用)フックの最初の1文だけで惹きつけること。「〜について紹介します」のような前置きは厳禁で、具体的な数字・意外な事実・断定的な一言から入る。前半で間延びさせず、後半に行くほど情報の意外性・インパクトが強くなる(尻すぼみにならない)構成にする
${retentionInstructions}

# 【最重要・絶対禁止事項】投資系チャンネル特有の安全ルール(fictionの有無に関わらず絶対に適用)
- 「今買うべき」「今が売り時」「そろそろ底値」等、特定の金融商品(通貨ペア・個別銘柄・暗号資産・コモディティ等)の具体的な売買タイミングを示唆・断定する表現は絶対禁止
- 特定の金融商品の将来の価格・値動きを断定的に予測する表現は絶対禁止
- 「必ず儲かる」「絶対に稼げる」「損はしない」など、利益や成功を保証・断定する表現は絶対禁止
- 個別の資産配分・具体的な投資判断そのものへのアドバイスは行わず、あくまで一般的な仕組み・過去の事実・公的統計の解説に留めること
- 実在のアナリスト・トレーダー・インフルエンサー・著名人等の実名や、個人の投資成績・私生活を扱わない
- 特定の金融機関・証券会社・取引所・暗号資産取引所の推奨または批判をしない
- 著作権のあるキャラクター・作品への言及は絶対に禁止
- 可能であれば、締め(outro)に「あくまで情報提供が目的であり、投資の勧誘・助言ではない」という趣旨を一言添える(概要欄にも固定の免責文を別途記載するため必須ではない)

# 重複コンテンツ判定を避けるための工夫(重要)
- フックの言い回し・構成の型は、過去のネタと違うパターンにすること(問いかけ型・数字型・比較型など毎回変える)
- ナレーションの語り口も、丁寧すぎる/フランクめ等、毎回少し変化をつける

# 誤読防止ルール
- narration(読み上げ用テキスト)の中に、次の漢字が含まれる場合は必ずひらがなに置き換えること: ${misreadingList}
- telop(画面表示用テキスト)は通常の漢字表記のままでよい

# SEO対策のルール(重要)
- このチャンネルは1日2本の高頻度投稿で本数を稼ぐ運用方針のため、ニッチな専門用語よりも「多くの人が実際に検索・閲覧する、知名度の高い言い回し」を優先すること
- titleには、検索ボリュームが大きいと想定される具体的なキーワード(専門用語・数字・「〜とは」等の定番の検索意図に合う言い回し)を、できるだけ前方(最初の10〜15字以内)に配置すること
- tagsには、検索ボリュームが見込める一般的なキーワード(例:FX,投資初心者)と、その動画固有の具体的キーワードを両方含めること。tagsは検索ボリュームが大きいと想定される順に並べること(先頭ほど需要が大きいものにする)
- tagsの中の最初の数個は概要欄のハッシュタグとしても自動的に使われる。ハッシュタグ化されることを踏まえ、tagsは以下のルールを守ること:
  - 名詞(または名詞の複合語)のみにすること。「とは」「なぜ」「どう」等を含む疑問形・文章のままの語句は一切タグにしない(誤った例:「スプレッドとは」「pipsとは」→ 正しい例:「スプレッド」「pips」)
  - 概要欄に固定で入るハッシュタグ(FX・テクニカル分析・ファンダメンタルズ分析・shorts)と完全に同じ単独語は避け、それらより具体的で、かつ検索需要も見込める複合語にすること(例:単なる「FX」ではなく「FX初心者」「FXレバレッジ」等)
- descriptionHookは、検索結果・スマホ画面で最初に表示される部分なので、動画の内容とキーワードが一目で伝わる1文にすること(曖昧な要約にしない)
- outro(締め)のnarrationには、「チャンネル登録」の呼びかけに加えて、無理のない範囲でコメント欄でのやり取りを促す一言(例:「あなたはどう思う?コメントで教えて」)も含めること(エンゲージメントはアルゴリズム評価に直結するため)。文字数上限(50〜55字)に収まらない場合は「チャンネル登録」を優先する
- seoNotesには、今回のタイトル・タグでどんなSEO対策をしたかを、日本語1〜2文で具体的に説明すること(実際に使った単語を挙げて説明すること)

# JSON出力上の重要な注意
- caption・narration・title等のテキスト内では、二重引用符(")を絶対に使わないこと。強調したい場合は「」(かぎ括弧)を使うこと。二重引用符を使うとJSONが壊れます。

# 出力JSON形式(このスキーマに厳密に従うこと)
{
  "title": "${titleInstructions}",
  "topics": ["${topicsInstructions}"],
  "descriptionHook": "概要欄の1行目。動画の内容を要約した1文",
  "tags": ["タグ1", "タグ2", "... 具体的なキーワードを8個程度"],
  "seoNotes": "今回のSEO対策の具体的な説明(1〜2文)",
${segmentsExample}
}`;

function runClaude(promptText) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN },
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
  if (start === -1 || end === -1) {
    throw new Error(`JSONが見つかりませんでした。出力: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

console.log(`claude -p で新しい台本を生成中...(ジャンル: ${category.name})`);
const raw = await runClaude(prompt);
const script = extractJson(raw);
script.category = category.name;
script.format = category.format;
script.displayGenre = category.displayGenre ?? category.name;

const requiredIds = ["hook", "rank3", "rank2", "rank1", "outro"];
const gotIds = script.segments.map((s) => s.id);
for (const id of requiredIds) {
  if (!gotIds.includes(id)) {
    throw new Error(`生成結果に "${id}" セグメントがありません`);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(script, null, 2));
console.log(`OK: ${outputPath} に保存しました`);
console.log(`タイトル: ${script.title}`);
