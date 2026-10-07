import type { Format, Strategy } from "@jarvis/core";

/** Formatos que já têm fábrica implementada. O resto entra com peso 0 até existir. */
export const IMPLEMENTED_FORMATS: readonly Format[] = ["carousel", "algoviz", "slideshow", "react", "text", "story"];

export function defaultStrategy(now = new Date()): Strategy {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    // "jarvis" (o sistema por dentro) saiu da pauta: o Caio não quer falar disso.
    pillarMix: { computacao: 45, geek: 27, bastidores: 13, jarvis: 0, liberdade: 15 },
    pillarFloors: { computacao: 25, geek: 10, bastidores: 5, jarvis: 0, liberdade: 5 },
    maxWeeklyShiftPts: 10,
    exploration: 0.2,
    packagesPerDay: 6,
    formatWeights: {
      carousel: 30,
      algoviz: 10,
      text: 20,
      story: 15,
      demo: 0,
      voice_reel: 0,
      slideshow: 25,
      react: 15,
      cut: 0,
      longform: 0,
      take: 0,
    },
    hookWeights: { pergunta: 15, choque: 15, lista: 15, eu_fiz: 15, contrarian: 15, historia: 15, tutorial: 10 },
    slots: {
      instagram: ["07:30", "12:00", "19:00"],
      tiktok: ["12:30", "20:00"],
      youtube: ["11:00", "18:00"],
      linkedin: ["08:00"],
      threads: ["09:00", "13:00", "21:00"],
      x: ["08:30", "12:30", "18:30", "22:00"],
    },
    pillarPlatforms: {
      computacao: ["instagram", "tiktok", "youtube", "linkedin", "threads", "x"],
      geek: ["instagram", "tiktok", "youtube", "linkedin", "threads", "x"],
      bastidores: ["instagram", "tiktok", "youtube", "linkedin", "threads", "x"],
      jarvis: ["instagram", "tiktok", "youtube", "linkedin", "threads", "x"],
      // Política/fé: só carrossel e texto, nunca voz clonada, nunca LinkedIn.
      liberdade: ["instagram", "threads", "x"],
    },
    hypeExpressThreshold: 0.75,
  };
}
