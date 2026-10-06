import { randomBytes } from "node:crypto";

/** Id ordenável por tempo: `20261006-1432-a1b2c3`. Legível no PWA e no git. */
export function newId(prefix = "", now: Date = new Date()): string {
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}`;
  const rand = randomBytes(3).toString("hex");
  return `${prefix}${stamp}-${rand}`;
}

/** Nome não adivinhável para arquivos expostos temporariamente no caio-cdn. */
export function unguessableName(): string {
  return randomBytes(16).toString("hex");
}
