import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "http://127.0.0.1:50021";

const outDir = path.join(root, "out", "voicevox-terms");
fs.mkdirSync(outDir, { recursive: true });

const speakers = await (await fetch(`${BASE}/speakers`)).json();
for (const sp of speakers) {
  const info = await (await fetch(`${BASE}/speaker_info?speaker_uuid=${sp.speaker_uuid}&resource_format=url`)).json();
  fs.writeFileSync(path.join(outDir, `${sp.name.replace(/[/]/g, "_")}.md`), info.policy ?? "(policyなし)");
  console.log(`===== ${sp.name} =====
${info.policy ?? "(policyなし)"}`);
}
