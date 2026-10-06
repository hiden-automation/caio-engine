import type { City, GaRun } from "@jarvis/sims";
import type { VisualTokens } from "./tokens.ts";

/** Desenha a melhor rota de uma geração como SVG (mapa abstrato dos bairros). */
export function routeSvg(run: GaRun, gen: number, t: VisualTokens, size = 860): string {
  const rec = run.history[Math.min(gen, run.history.length - 1)]!;
  const pad = 60;
  const lats = run.cities.map((c) => c.lat);
  const lons = run.cities.map((c) => c.lon);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const span = Math.max(maxLat - minLat, maxLon - minLon);
  const xy = (c: City): [number, number] => [
    pad + ((c.lon - minLon) / span) * (size - 2 * pad),
    pad + ((maxLat - c.lat) / span) * (size - 2 * pad),
  ];

  const pts = rec.bestRoute.map((i) => xy(run.cities[i]!));
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
  const dots = run.cities
    .map((c) => {
      const [x, y] = xy(c);
      const home = c.name === "Perdizes";
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${home ? 11 : 7}" fill="${home ? t.colors.accent2 : t.colors.fg}"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <path d="${path}" fill="none" stroke="${t.colors.accent}" stroke-width="4" stroke-linejoin="round" opacity="0.95"/>
  ${dots}
</svg>`;
}
