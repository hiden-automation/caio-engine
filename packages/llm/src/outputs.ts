import { z } from "zod";
import { Format, HookType, LibraryTags, License, Pillar, Platform, VariantKind } from "@jarvis/core";

/*
 * Schemas de saída do LLM: todos os campos obrigatórios e sem defaults,
 * para casar com a saída estruturada. Limites numéricos são aplicados no
 * código (clamp), não no schema.
 */

export const TriageOutput = z.object({
  items: z.array(
    z.object({
      signalId: z.string(),
      keep: z.boolean().describe("true se existe um ângulo forte e seguro para o Caio"),
      pillarFit: z.number().describe("0 a 1: aderência aos pilares"),
      risk: z.number().describe("0 a 1: risco de marca, direitos autorais ou eleitoral"),
      saturation: z.number().describe("0 a 1: o quanto o tema já está batido"),
      pillar: Pillar,
      title: z.string().describe("título da ideia, do jeito que o Caio falaria"),
      angle: z.string().describe("o ângulo do Caio: como conectar o hype a computação, negócios ou geek"),
      suggestedFormat: Format,
    }),
  ),
});
export type TriageOutput = z.infer<typeof TriageOutput>;

export const SlideOut = z.object({
  title: z.string(),
  body: z.string(),
  visual: z.string().describe("um dos visuais da lista (ex.: capa:L3, texto, chat, foto:L5, cta)"),
  code: z.string().describe('código/terminal quando visual="codigo" ou "terminal"; senão ""'),
  durationSec: z.number().describe("só reels: segundos da cena; 0 = automático"),
});

export const WriterOutput = z.object({
  topic: z.string(),
  angle: z.string(),
  hookType: HookType,
  hooks: z.array(z.string()).describe("3 ganchos alternativos para A/B"),
  chosenHook: z.string(),
  firstFrame: z.enum(["rosto", "texto", "simulacao", "tela"]),
  series: z.string().describe('nome curto da série recorrente (ex.: "LLM por dentro", "Geek × Negócios", "Evolução ao vivo", "Diário do JARVIS"), ou ""'),
  style: z.enum(["hud", "post", "quadro"]),
  slides: z.array(SlideOut),
  variants: z.array(
    z.object({
      platform: Platform,
      kind: VariantKind,
      caption: z.string(),
      threadParts: z.array(z.string()).describe("partes seguintes de uma thread; [] se não for thread"),
    }),
  ),
  sources: z.array(z.object({ title: z.string(), url: z.string(), license: License })),
});
export type WriterOutput = z.infer<typeof WriterOutput>;

export const JudgeOutput = z.object({
  score: z.number().describe("0 a 10: qualidade e aderência à marca"),
  blocking: z.boolean().describe("true se há problema que impede publicar"),
  issues: z.array(z.string()),
  fixInstructions: z.string().describe("o que o roteirista deve mudar na próxima tentativa; \"\" se nada"),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export const TagOutput = z.object({
  items: z.array(LibraryTags.extend({ id: z.string() })),
});
export type TagOutput = z.infer<typeof TagOutput>;
