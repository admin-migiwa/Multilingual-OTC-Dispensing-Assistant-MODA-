// Azure AI Speech の日本語の声を聞き比べるための見本を、1つのファイルにまとめて作る。
// 使い方：node voice-samples.mjs   → out/voice-samples-azure.m4a（声の順番は画面に表示）
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { azureSpeak, loadAzureConfig } from "./azure-tts.mjs";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const SAMPLE = "モダは、言語の壁をなくす接客支援。AIは助言せず、訳して聞き取るだけ。判断は薬剤師です。";
// 落ち着いた・知的に聞こえやすい声を中心に選ぶ（中性的に近づけるため、高さを少し変えた版も入れる）
const VOICES = [
  { label: "Nanami（女性・落ち着き）", name: "ja-JP-NanamiNeural" },
  { label: "Nanami（低め）", name: "ja-JP-NanamiNeural", pitch: "-8%" },
  { label: "Shiori（女性）", name: "ja-JP-ShioriNeural" },
  { label: "Mayu（女性）", name: "ja-JP-MayuNeural" },
  { label: "Aoi（女性）", name: "ja-JP-AoiNeural" },
  { label: "Keita（男性）", name: "ja-JP-KeitaNeural" },
  { label: "Naoki（男性）", name: "ja-JP-NaokiNeural" },
  { label: "Naoki（高め）", name: "ja-JP-NaokiNeural", pitch: "+8%" },
  { label: "Daichi（男性）", name: "ja-JP-DaichiNeural" },
];

const config = loadAzureConfig();
const dir = resolve("out", "voice", "azure-samples");
mkdirSync(dir, { recursive: true });
const files = [];
for (const [i, v] of VOICES.entries()) {
  const wav = join(dir, `${i + 1}.wav`);
  await azureSpeak(SAMPLE, { name: v.name, pitch: v.pitch ?? "+0%", rate: "+8%" }, wav, config);
  files.push(wav);
  process.stdout.write(`${i + 1}. ${v.label}\n`);
}
// 1秒ずつ間を空けてつなぐ
const inputs = files.flatMap((f) => ["-i", f]);
const parts = files.map((_, i) => `[${i}:a]aresample=44100,apad=pad_dur=1[a${i}]`);
const chain = files.map((_, i) => `[a${i}]`).join("");
const out = resolve("out", "voice-samples-azure.m4a");
const r = spawnSync(findFfmpeg(), [
  "-y", "-loglevel", "error", ...inputs,
  "-filter_complex", `${parts.join(";")};${chain}concat=n=${files.length}:v=0:a=1[o]`,
  "-map", "[o]", "-b:a", "160k", out,
], { encoding: "utf8" });
if (r.status !== 0) throw new Error(`FFmpeg が失敗しました：${r.stderr}`);
process.stdout.write(`聞き比べ用のファイルを作りました：${out}\n`);
