// ナレーションを作って、効果音と1本の音声（WAV）にまとめる。
// 読み上げは Windows に入っている日本語の音声で、パソコンの中だけで作る（tts.ps1）。外部のサービスには送らない。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_TEMPO = 1.3; // これより速くしないと収まらない文は、文を短くするよう知らせる
const SFX_VOLUME_WITH_VOICE = 0.6; // ナレーションがあるときは効果音をさらに下げる

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
function synthesize(line, voice, cacheDir) {
  const key = createHash("sha1").update(JSON.stringify([line.text, voice])).digest("hex").slice(0, 12);
  const wav = join(cacheDir, `${key}.wav`);
  if (!existsSync(wav)) {
    const txt = join(cacheDir, `${key}.txt`);
    writeFileSync(txt, line.text, "utf8");
    run("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "tts.ps1"),
      "-TextFile", txt, "-Out", wav, "-Voice", voice.voice, "-Pitch", String(voice.pitch), "-Rate", String(voice.rate),
    ]);
  }
  return wav;
}

/** 効果音の WAV にナレーションを重ねた WAV を作り、そのパスを返す。ナレーションがなければ効果音の WAV をそのまま返す。 */
export function mixNarration({ ffmpeg, sfxWav, lines, voice, outWav }) {
  if (!lines || lines.length === 0) return sfxWav;
  const cacheDir = resolve(here, "out", "voice", "cache");
  mkdirSync(cacheDir, { recursive: true });
  const inputs = ["-i", sfxWav];
  const filters = [`[0:a]volume=${SFX_VOLUME_WITH_VOICE}[sfx]`];
  const labels = ["[sfx]"];
  lines.forEach((line, i) => {
    const wav = synthesize(line, voice, cacheDir);
    const len = duration(ffmpeg, wav);
    const tempo = Math.max(1, len / line.max);
    if (tempo > MAX_TEMPO) {
      process.stderr.write(`注意：「${line.text.slice(0, 20)}…」は ${len.toFixed(1)} 秒あり、${line.max} 秒に収めるには ${tempo.toFixed(2)} 倍速が必要です。文を短くしてください。\n`);
    }
    const ms = Math.round(line.t * 1000);
    inputs.push("-i", wav);
    filters.push(`[${i + 1}:a]aresample=44100,aformat=channel_layouts=mono,atempo=${tempo.toFixed(3)},adelay=${ms}:all=1,volume=1.6[n${i}]`);
    labels.push(`[n${i}]`);
  });
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first,alimiter=limit=0.95[out]`);
  run(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-ar", "44100", outWav]);
  return outWav;
}
