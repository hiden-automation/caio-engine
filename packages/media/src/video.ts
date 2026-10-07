import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { FFMPEG, probe, run } from "./ffmpeg.ts";

/** N quadros espalhados pelo vídeo (para a IA etiquetar). */
export async function keyframes(src: string, outDir: string, n = 3): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const { durationSec } = await probe(src);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (durationSec * (i + 0.5)) / n;
    const file = join(outDir, `frame-${i + 1}.jpg`);
    await run(FFMPEG, ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", file]);
    out.push(file);
  }
  return out;
}

/** B-roll normalizado: 1080×1920, 30 fps, sem áudio, até `maxSec`. Corta em volta do foco. */
export async function verticalClip(src: string, dst: string, focusX = 0.5, maxSec = 20): Promise<void> {
  const fx = Math.max(0, Math.min(1, focusX)).toFixed(3);
  const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)*${fx}:(in_h-1920)/2,fps=30`;
  await run(FFMPEG, ["-v", "error", "-y", "-i", src, "-t", String(maxSec), "-an", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", dst]);
}

/** Quadros JPEG de um trecho do clipe, na taxa do reel (cena de b-roll). */
export async function clipFrames(clip: string, outDir: string, startSec: number, durationSec: number, fps = 30): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  await run(FFMPEG, ["-v", "error", "-y", "-ss", startSec.toFixed(2), "-i", clip, "-t", durationSec.toFixed(2), "-vf", `fps=${fps}`, "-q:v", "4", join(outDir, "%05d.jpg")]);
  return (await readdir(outDir)).filter((f) => f.endsWith(".jpg")).sort().map((f) => join(outDir, f));
}

/** Sequência de quadros + trilha → MP4 H.264/AAC pronto para Reels. */
export async function encodeReel(framesPattern: string, fps: number, audio: string | undefined, dst: string): Promise<void> {
  const args = ["-v", "error", "-y", "-framerate", String(fps), "-i", framesPattern];
  if (audio) args.push("-i", audio);
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
  if (audio) args.push("-c:a", "aac", "-b:a", "160k", "-shortest");
  args.push(dst);
  await run(FFMPEG, args);
}
