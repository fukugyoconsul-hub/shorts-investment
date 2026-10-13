import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { google } from "googleapis";

// YouTubeを操作する前に、認証トークンが正しいチャンネル(TACグループ @tac_group)に紐づいているかを確認する。
// 同名のブランドアカウント(@tac633)を再認証時に誤って選び、1週間分の動画が別チャンネルに投稿された事故の再発防止。
export const EXPECTED_CHANNEL_ID = "UC9nkp9qN8BBGejL-TppCy5w";
export const WRONG_CHANNEL_EXIT_CODE = 2;

export class WrongChannelError extends Error {}

export async function assertCorrectChannel(youtube) {
  const res = await youtube.channels.list({ part: ["snippet"], mine: true });
  const ch = res.data.items?.[0];
  if (ch?.id !== EXPECTED_CHANNEL_ID) {
    throw new WrongChannelError(
      `認証トークンのチャンネルが違います(現在: ${ch?.snippet?.title ?? "不明"} ${ch?.snippet?.customUrl ?? ""} ${ch?.id ?? "なし"} / 正: @tac_group ${EXPECTED_CHANNEL_ID})。YouTubeの再認証で正しいチャンネルを選び直す必要があります`
    );
  }
  return ch;
}

// 単体で実行した場合: 確認だけ行い、違うチャンネルなら終了コード2、その他のエラーなら1で終わる
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
  const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8")));
  try {
    const ch = await assertCorrectChannel(google.youtube({ version: "v3", auth: oauth2Client }));
    console.log(`OK: 投稿先チャンネルを確認しました(${ch.snippet.title} ${ch.snippet.customUrl} ${ch.id})`);
  } catch (err) {
    console.error(err.message);
    process.exit(err instanceof WrongChannelError ? WRONG_CHANNEL_EXIT_CODE : 1);
  }
}
