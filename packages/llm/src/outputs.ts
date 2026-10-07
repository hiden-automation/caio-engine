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
  visual: z.string().describe("um dos visuais da lista (ex.: capa:L3, texto, prompt, imagem, foto:L5, cta)"),
  imageQuery: z.string().describe('busca em inglês da imagem do assunto quando visual="imagem" ou "capa:img"; senão ""'),
  narration: z.string().describe('reels: o que o locutor fala nesta cena; carrossel/story: ""'),
  code: z.string().describe('sempre ""'),
  durationSec: z.number().describe("sempre 0 (automático)"),
});

export const WriterOutput = z.object({
  topic: z.string(),
  angle: z.string(),
  message: z.string().describe("A mensagem do post em UMA frase simples, que um leigo entende"),
  takeaway: z.string().describe("o que a pessoa sabe ou consegue fazer depois de ver o post"),
  outline: z.array(z.string()).describe("o roteiro: uma linha por slide/cena, em ordem lógica, cada uma levando à próxima"),
  hookType: HookType,
  hooks: z.array(z.string()).describe("3 ganchos alternativos para A/B"),
  chosenHook: z.string(),
  firstFrame: z.enum(["rosto", "texto", "simulacao", "tela"]),
  series: z.string().describe('nome curto da série recorrente (ex.: "IA por dentro", "Geek × Negócios", "Evolução ao vivo", "Automação sem código"), ou ""'),
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
  messageUnderstood: z.string().describe("a mensagem que VOCÊ entendeu lendo só o conteúdo, em 1 frase (\"não ficou clara\" se for o caso)"),
  clarity: z.number().describe("0 a 10: um leigo entende de primeira, a sequência é lógica e coesa?"),
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

export const SourceBrief = z.object({
  description: z.string().describe("o que acontece no vídeo, em 2–4 frases objetivas"),
  moments: z.array(z.object({ atSec: z.number(), what: z.string() })).describe("momentos marcantes (pelos quadros)"),
});
export type SourceBrief = z.infer<typeof SourceBrief>;

export const ImagePick = z.object({
  index: z.number().describe("número da imagem que melhor mostra o assunto (1..N), ou 0 se nenhuma serve"),
  why: z.string(),
});
export type ImagePick = z.infer<typeof ImagePick>;
