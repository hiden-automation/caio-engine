import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const FFMPEG: string = process.env.FFMPEG_PATH ?? (require("ffmpeg-static") as string);
export const FFPROBE: string = process.env.FFPROBE_PATH ?? (require("ffprobe-static") as { path: string }).path;

export function run(bin: string, args: string[], input?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin.split(/[\/]/).pop()} saiu com ${code}: ${err.slice(-400)}`))));
    child.stdin.end(input);
  });
}

export interface Probe {
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
}

/** Dimensões já corrigidas pela rotação (vídeo de celular gravado "deitado"). */
export async function probe(file: string): Promise<Probe> {
  const out = JSON.parse(
    await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]),
  ) as { streams: { codec_type: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[]; format: { duration?: string } };
  const v = out.streams.find((s) => s.codec_type === "video");
  const rot = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180;
  const w = v?.width ?? 0;
  const h = v?.height ?? 0;
  return {
    width: rot === 90 ? h : w,
    height: rot === 90 ? w : h,
    durationSec: Number(out.format.duration ?? 0),
    hasAudio: out.streams.some((s) => s.codec_type === "audio"),
  };
}
