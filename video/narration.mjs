// ナレーションを作って、効果音・BGM と1本の音声（WAV）にまとめる。
// 読み上げは Azure AI Speech（azure-tts.mjs、原稿だけを送る）か、Windows に入っている声（tts.ps1、パソコンの中だけ）で作る。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { azureSpeak } from "./azure-tts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_TEMPO = 1.3; // これより速くしないと収まらない文は、文を短くするよう知らせる
const SFX_VOLUME_WITH_VOICE = 0.6; // ナレーションがあるときは効果音をさらに下げる
// 収録した声らしくする仕上げ：こもりを取り、少しだけ部屋の響きを足す。強弱は残す（音量を平らにならさない）
const POLISH = "highpass=f=80,equalizer=f=3000:t=q:w=1:g=2,aecho=0.8:0.6:28|47:0.10|0.06,acompressor=threshold=0.35:ratio=1.5:attack=10:release=120";
// 声の大きさのゆっくりした波（voice.drift が true のとき）
const DRIFT = "tremolo=f=0.6:d=0.06";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} が失敗しました：${r.stderr || r.stdout}`);
  return r.stdout;
}

function duration(ffmpeg, file) {
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
  return Number(run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
}

// 1文ずつ読み上げ音声を作る（同じ文・同じ声なら前に作ったものを使う）
// voice.engine："azure"（Azure AI Speech）か "windows"（Windows に入っている声）。
// 環境変数 VOICE_ENGINE=windows で、いったん Windows の声に切り替えられる。
async function synthesize(line, voiceSetting, cacheDir) {
  const engine = process.env.VOICE_ENGINE || voiceSetting.engine || "windows";
  const voice = voiceSetting[engine];
  if (!voice) throw new Error(`声の設定「${engine}」が NARRATION_VOICE にありません`);
  const key = createHash("sha1").update(JSON.stringify([line.text, engine, voice])).digest("hex").slice(0, 12);
  const wav = join(cacheDir, `${key}.wav`);
  if (!existsSync(wav)) {
    const txt = join(cacheDir, `${key}.txt`);
    writeFileSync(txt, line.text, "utf8");
    if (engine === "azure") {
      await azureSpeak(line.text, voice, wav);
    } else if (engine === "windows") {
      writeFileSync(txt, line.text.replace(/[{}]/g, ""), "utf8"); // 強調の印 {} は Windows の声では使わない
      run("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "tts.ps1"),
        "-TextFile", txt, "-Out", wav, "-Voice", voice.voice, "-Pitch", String(voice.pitch), "-Rate", String(voice.rate),
      ]);
    } else {
      throw new Error(`声の種類「${engine}」には対応していません`);
    }
  }
  return { wav, engine, voice };
}

const BGM_VOLUME = 0.42; // BGM はナレーションより十分小さく。さらにナレーションの間は自動で下げる

/**
 * 効果音・BGM・ナレーションを1本の WAV にまとめ、そのパスを返す。
 * ナレーションが鳴っている間は、BGM の音量を自動で下げる（声を聞き取りやすくするため）。
 */
export async function mixAudio({ ffmpeg, sfxWav, bgmWav, lines, voice, outWav }) {
  const voiceLines = lines ?? [];
  const inputs = ["-i", sfxWav];
  const filters = [`[0:a]volume=${voiceLines.length ? SFX_VOLUME_WITH_VOICE : 1}[sfx]`];
  const finalLabels = ["[sfx]"];
  let next = 1;
  let bgmIndex = -1;
  if (bgmWav) { inputs.push("-i", bgmWav); bgmIndex = next++; }

  const voiceLabels = [];
  if (voiceLines.length) {
    const cacheDir = resolve(here, "out", "voice", "cache");
    mkdirSync(cacheDir, { recursive: true });
    for (const [i, line] of voiceLines.entries()) {
      const { wav, engine, voice: v } = await synthesize(line, voice, cacheDir);
      const len = duration(ffmpeg, wav);
      const tempo = Math.max(1, len / line.max);
      if (tempo > MAX_TEMPO) {
        process.stderr.write(`注意：「${line.text.slice(0, 20)}…」は ${len.toFixed(1)} 秒あり、${line.max} 秒に収めるには ${tempo.toFixed(2)} 倍速が必要です。文を短くしてください。
`);
      }
      const ms = Math.round(line.t * 1000);
      inputs.push("-i", wav);
      const finish = engine === "azure" ? `${v.drift ? DRIFT + "," : ""}${POLISH},volume=2.2` : "volume=1.6";
      filters.push(`[${next}:a]aresample=44100,aformat=channel_layouts=mono,${finish},atempo=${tempo.toFixed(3)},adelay=${ms}:all=1[n${i}]`);
      voiceLabels.push(`[n${i}]`);
      next++;
    }
    filters.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest,asplit=2[voice][vsc]`);
  }
  if (bgmIndex >= 0) {
    if (voiceLines.length) {
      // 声が鳴ると BGM が下がり、止まるとゆっくり戻る
      filters.push(`[${bgmIndex}:a]aresample=44100,aformat=channel_layouts=mono,volume=${BGM_VOLUME}[bgm0]`);
      filters.push(`[bgm0][vsc]sidechaincompress=threshold=0.02:ratio=5:attack=40:release=600[bgm]`);
    } else {
      filters.push(`[${bgmIndex}:a]aresample=44100,aformat=channel_layouts=mono,volume=${BGM_VOLUME}[bgm]`);
    }
    finalLabels.push("[bgm]");
  } else if (voiceLines.length) {
    filters.push("[vsc]anullsink");
  }
  if (voiceLines.length) finalLabels.push("[voice]");
  if (finalLabels.length === 1) return sfxWav;
  filters.push(`${finalLabels.join("")}amix=inputs=${finalLabels.length}:normalize=0:duration=first,alimiter=limit=0.95[out]`);
  run(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-ar", "44100", outWav]);
  return outWav;
}
