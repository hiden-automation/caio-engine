import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/cutout.py", import.meta.url));

/** Recorta o fundo de várias imagens (rembg). Sem Python/rembg instalado, devolve false. */
export function cutoutMany(pairs: [src: string, dst: string][]): Promise<boolean> {
  if (!pairs.length) return Promise.resolve(true);
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  return new Promise((resolve) => {
    const child = spawn(python, [SCRIPT, ...pairs.flat()], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      if (code !== 0) console.error(`[jarvis] cutout falhou: ${err.slice(-300)}`);
      resolve(code === 0);
    });
  });
}
