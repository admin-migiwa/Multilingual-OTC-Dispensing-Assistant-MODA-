// Azure AI Speech（日本リージョン）でナレーションの音声を作る。
// キーは video/.env.local（Git の対象外）か環境変数に置き、画面やログには出さない（CLAUDE.md 絶対ルール9）。
// 送るのはナレーションの原稿だけ。患者さんの情報は含まない。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sdk from "microsoft-cognitiveservices-speech-sdk";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** video/.env.local から AZURE_SPEECH_KEY と AZURE_SPEECH_REGION を読む（環境変数が先） */
export function loadAzureConfig() {
  const file = join(here, ".env.local");
  const fromFile = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const key = process.env.AZURE_SPEECH_KEY || fromFile.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || fromFile.AZURE_SPEECH_REGION || "japaneast";
  if (!key) {
    throw new Error(
      "Azure のキーが見つかりません。video/.env.local に AZURE_SPEECH_KEY=（キー）を書いてください。" +
        "いったん Windows の声で作るときは、環境変数 VOICE_ENGINE=windows を付けて実行します。",
    );
  }
  return { key, region };
}

// 原稿から決まる乱数（同じ文なら同じ揺れになる）
function seededRandom(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

/**
 * 1文を読み上げて WAV に保存する。
 * voice: { name, rate, pitch, pause?, style?, emphasisRate?, emphasisPitch?, emphasisGainDb? }
 * 原稿の {…} で囲んだ大事な言葉は、少しゆっくり・少し高めに読ませ、さらにその部分だけ後から音量を上げる。
 * （Azure の volume 指定はほとんど効かないため、言葉の位置を Azure の「しおり（bookmark）」で受け取り、FFmpeg で上げる）
 */
export async function azureSpeak(text, voice, outWav, config = loadAzureConfig()) {
  let body = escapeXml(text);
  // 揺れ（voice.wobble）：句（、。で区切った部分）ごとに、速さと高さをわずかにずらし、文の間の長さも毎回少し変える。
  // 同じ原稿なら毎回同じ揺れになるよう、原稿から決まる乱数を使う（作り直しても結果が変わらない）。
  const rand = seededRandom(text);
  const wob = voice.wobble;
  if (wob) {
    const signed = (range) => {
      const v = (rand() * 2 - 1) * range;
      return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
    };
    body = body
      .split(/(?<=[、。])/)
      .map((p) => `<prosody rate="${signed(wob.rate)}" pitch="${signed(wob.pitch)}">${p}</prosody>`)
      .join("");
  }
  // 文の切れ目（。）に少し間を入れると、読み上げっぽさが減る（voice.pause＝ミリ秒。揺れがあるときは長さを少し変える）
  if (voice.pause) {
    body = body.replace(/。(<\/prosody>)?(?=.)/g, (_m, close = "") => {
      const ms = wob ? Math.round(voice.pause * (0.7 + rand() * 0.7)) : voice.pause;
      return `。${close}<break time="${ms}ms"/>`;
    });
  }
  const slow = voice.emphasisRate ?? "-12%";
  const lift = voice.emphasisPitch ?? "+3%";
  let n = 0;
  body = body.replace(/\{([^}]+)\}/g, (_, w) => {
    const i = n++;
    return `<bookmark mark="s${i}"/><prosody rate="${slow}" pitch="${lift}">${w}</prosody><bookmark mark="e${i}"/>`;
  });
  const prosody = `<prosody rate="${voice.rate ?? "+0%"}" pitch="${voice.pitch ?? "+0%"}">${body}</prosody>`;
  const inner = voice.style ? `<mstts:express-as style="${voice.style}">${prosody}</mstts:express-as>` : prosody;
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ja-JP">` +
    `<voice name="${voice.name}">${inner}</voice></speak>`;

  const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
  const synth = new sdk.SpeechSynthesizer(speechConfig, null);
  const marks = {};
  synth.bookmarkReached = (_s, e) => { marks[e.text] = e.audioOffset / 1e7; }; // 100ナノ秒単位 → 秒
  const result = await new Promise((ok, ng) => synth.speakSsmlAsync(ssml, ok, ng));
  synth.close();
  if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
    // キーは出さず、何が起きたかだけ伝える
    const detail = sdk.CancellationDetails.fromResult(result);
    const hint = /401|auth/i.test(detail.errorDetails ?? "") ? "（キーかリージョンが違う可能性があります）" : "";
    throw new Error(`Azure の読み上げが失敗しました：${sdk.CancellationErrorCode[detail.ErrorCode] ?? ""} ${(detail.errorDetails ?? "").slice(0, 200)}${hint}`);
  }
  const raw = outWav.replace(/\.wav$/, ".raw.wav");
  writeFileSync(raw, Buffer.from(result.audioData));

  // 大事な言葉の区間だけ音量を上げる（前後40ミリ秒でなめらかに）
  const gain = Math.pow(10, (voice.emphasisGainDb ?? 0) / 20) - 1;
  const spans = [];
  for (let i = 0; i < n; i++) {
    if (marks[`s${i}`] != null && marks[`e${i}`] != null) spans.push([marks[`s${i}`], marks[`e${i}`]]);
  }
  let af = "anull";
  if (gain > 0 && spans.length) {
    const ramps = spans
      .map(([a, b]) => `max(0,min(1,min((t-${a.toFixed(3)})/0.04,(${b.toFixed(3)}-t)/0.04)))`)
      .join("+");
    af = `volume=volume='1+${gain.toFixed(3)}*(${ramps})':eval=frame,alimiter=limit=0.95`;
  }
  const r = spawnSync(findFfmpeg(), ["-y", "-loglevel", "error", "-i", raw, "-af", af, outWav], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`FFmpeg が失敗しました：${r.stderr}`);
  rmSync(raw);
  return { spans };
}
