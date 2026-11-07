// FFmpeg の場所を探す。winget で入れた FFmpeg は、PATH に入る前でも見つけられるようにする。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const winget = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet");
  const link = join(winget, "Links", "ffmpeg.exe");
  if (existsSync(link)) return link;
  const pkgs = join(winget, "Packages");
  if (existsSync(pkgs)) {
    for (const p of readdirSync(pkgs).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      for (const b of readdirSync(join(pkgs, p))) {
        const exe = join(pkgs, p, b, "bin", "ffmpeg.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return "ffmpeg";
}
