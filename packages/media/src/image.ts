import sharp from "sharp";

/** Foto da base → JPEG com orientação corrigida (lado maior ≤ max). */
export async function normalizeImage(src: string, dst: string, max = 1920): Promise<{ width: number; height: number }> {
  const info = await sharp(src).rotate().resize(max, max, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(dst);
  return { width: info.width, height: info.height };
}

/**
 * Avatar redondo a partir do recorte (PNG com transparência): acha a cabeça
 * pelo topo da silhueta (as linhas mais altas, antes dos ombros alargarem).
 */
export async function avatarFromCutout(cutout: string, dst: string, size = 400): Promise<void> {
  const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const rows: { y: number; l: number; r: number }[] = [];
  for (let y = 0; y < H; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3]! > 128) {
        if (l < 0) l = x;
        r = x;
      }
    }
    if (l >= 0) rows.push({ y, l, r });
  }
  if (!rows.length) throw new Error("recorte vazio");
  const top = rows[0]!.y;
  const personH = rows.at(-1)!.y - top;
  // Cabeça ≈ 18% superiores da silhueta de busto; largura = mediana dessas linhas.
  const head = rows.filter((r) => r.y < top + personH * 0.18);
  const widths = head.map((r) => r.r - r.l).sort((a, b) => a - b);
  const headW = widths[Math.floor(widths.length * 0.8)] ?? W / 3;
  const cx = head.reduce((a, r) => a + (r.l + r.r) / 2, 0) / head.length;
  const side = Math.min(W, H, Math.round(headW * 1.9));
  const left = Math.max(0, Math.min(W - side, Math.round(cx - side / 2)));
  const t = Math.max(0, Math.min(H - side, Math.round(top - side * 0.1)));
  await sharp(cutout)
    .extract({ left, top: t, width: side, height: side })
    .resize(size, size)
    .flatten({ background: "#141B27" })
    .jpeg({ quality: 90 })
    .toFile(dst);
}

/** Story livre: a foto ocupando a tela 9:16, recorte guiado pelo que chama atenção. */
export async function storyFrame(src: string, dst: string): Promise<void> {
  await sharp(src).rotate().resize(1080, 1920, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 90 }).toFile(dst);
}
