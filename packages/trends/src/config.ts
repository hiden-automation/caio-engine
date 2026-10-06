import { z } from "zod";

/** `trends.yml` no caio-data: o que monitorar. */
export const TrendsConfig = z.object({
  rss: z
    .array(z.object({ name: z.string(), url: z.string(), tags: z.array(z.string()).default([]) }))
    .default([]),
  reddit: z.array(z.string()).default([]),
  youtubeKeywords: z.array(z.string()).default([]),
  googleTrendsGeo: z.string().default("BR"),
  hackerNews: z.boolean().default(true),
  githubTrending: z.boolean().default(true),
  huggingFace: z.boolean().default(true),
  /** Quantos sinais vão para a triagem do LLM por rodada. */
  triageTopN: z.number().int().default(40),
  /** Hype mínimo para virar ideia. */
  ideaThreshold: z.number().default(0.45),
});
export type TrendsConfig = z.infer<typeof TrendsConfig>;
