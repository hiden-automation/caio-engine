/**
 * Gera apps/pwa/demo/ (feed + imagens) rodando o pipeline real de produção
 * com um LLM simulado. Uso: npx tsx apps/pwa/scripts/make-demo.ts
 * Depois: npm run pwa:dev e conecte com repositório "demo/demo" e token "demo".
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { Budget, FsStore } from "@jarvis/core";
import { Llm, stableSystem, type WriterOutput } from "@jarvis/llm";
import { VisualTokens } from "@jarvis/visuals";
import { initData } from "../../cli/src/init-data.ts";
import { produce } from "../../cli/src/produce.ts";
import { writeFeed } from "../../cli/src/feed.ts";
import type { Ctx } from "../../cli/src/context.ts";

const DRAFTS: Record<string, WriterOutput> = {
  algoviz: {
    topic: "Algoritmo genético achando a melhor rota entre 30 bairros de SP",
    angle: "A evolução resolvendo um problema que trava qualquer computador na força bruta",
    hookType: "eu_fiz",
    hooks: ["Deixei a evolução planejar meu rolê por SP", "30 bairros, 1 rota: quem resolve?", "Darwin entende de logística?"],
    chosenHook: "Deixei a evolução achar o caminho mais curto entre 30 bairros de SP",
    firstFrame: "simulacao",
    series: "Evolução ao vivo",
    slides: [
      { title: "Deixei a **evolução** achar o caminho mais curto entre 30 bairros de SP", body: "", visual: "capa", code: "" },
      { title: "Geração 0: puro caos", body: "120 rotas aleatórias.", visual: "sim:0", code: "" },
      { title: "Como um algoritmo genético pensa", body: "Cria rotas aleatórias\nMede cada uma\nAs melhores viram pais\nCruza duas rotas\nMuta um trecho", visual: "lista", code: "" },
      { title: "Geração 300", body: "", visual: "sim:300", code: "" },
      { title: "Semana que vem você escolhe o problema", body: "Comenta aqui o próximo desafio.", visual: "cta", code: "" },
    ],
    variants: [
      { platform: "instagram", kind: "carousel", caption: "Deixei um algoritmo genético planejar uma rota por 30 bairros de SP. Começou no caos e foi melhorando sozinho, geração após geração. Salva pra ver de novo. #algoritmos #ia", threadParts: [] },
      { platform: "linkedin", kind: "document", caption: "Algoritmos genéticos não são só teoria de faculdade: problemas de rota aparecem em entrega, visita técnica e logística de PME.", threadParts: [] },
      { platform: "threads", kind: "carousel", caption: "A evolução resolvendo o trânsito de SP (mais ou menos)", threadParts: [] },
      { platform: "x", kind: "carousel", caption: "Deixei a evolução achar a melhor rota entre 30 bairros de SP. Olha a geração 0 vs a 300.", threadParts: [] },
    ],
    sources: [],
  },
  carousel: {
    topic: "Darth Vader era um péssimo gestor",
    angle: "Lições de gestão (do que não fazer) com o Império",
    hookType: "contrarian",
    hooks: ["Darth Vader era um péssimo gestor", "O Império caiu por falta de processo", "Você gerencia como um Sith?"],
    chosenHook: "Darth Vader era um péssimo gestor (e o Império pagou caro)",
    firstFrame: "texto",
    series: "Geek × negócios",
    slides: [
      { title: "Darth Vader era um **péssimo gestor**", body: "E o Império pagou caro por isso.", visual: "capa", code: "" },
      { title: "Erro 1: feedback por estrangulamento", body: "Errou? Falta de ar. Resultado: ninguém reporta problema cedo.", visual: "texto", code: "" },
      { title: "Erro 2: ponto único de falha", body: "Duas Estrelas da Morte com o mesmo defeito de projeto.", visual: "texto", code: "" },
      { title: "Microgestão || Processo", body: "Vader pilotando tudo pessoalmente || Rebeldes com papéis claros", visual: "comparacao", code: "" },
      { title: "Automatize o processo, não o medo", body: "Salva e manda pro seu gestor (ou não).", visual: "cta", code: "" },
    ],
    variants: [
      { platform: "instagram", kind: "carousel", caption: "Darth Vader tinha poder, recurso e uma frota inteira. Faltou gestão. Arrasta e me diz qual erro você já viu numa empresa. #starwars #gestao", threadParts: [] },
      { platform: "threads", kind: "carousel", caption: "Vader seria demitido em qualquer PME séria", threadParts: [] },
      { platform: "x", kind: "carousel", caption: "Darth Vader era um péssimo gestor. Fio:", threadParts: [] },
    ],
    sources: [],
  },
  text: {
    topic: "Por que pequena empresa deveria automatizar o boring primeiro",
    angle: "O tédio é o melhor indicador de automação",
    hookType: "contrarian",
    hooks: ["Automatize o chato, não o legal", "IA na sua empresa começa pela planilha", "O robô certo é o mais sem graça"],
    chosenHook: "A primeira automação de uma PME deveria ser a mais sem graça.",
    firstFrame: "texto",
    series: "",
    slides: [],
    variants: [
      { platform: "x", kind: "thread", caption: "A primeira automação de uma pequena empresa deveria ser a mais sem graça.", threadParts: ["Não é chatbot. É a planilha que alguém copia e cola toda segunda.", "Regra: se uma tarefa te dá sono e acontece toda semana, ela é candidata.", "O ganho não é só tempo. É parar de errar no copia e cola."] },
      { platform: "threads", kind: "text", caption: "Toda PME quer um chatbot com IA. Quase nenhuma automatizou a planilha que alguém copia e cola toda segunda. Comece pelo chato.", threadParts: [] },
      { platform: "linkedin", kind: "text", caption: "A primeira automação de uma pequena empresa deveria ser a mais sem graça.\n\nNão é o chatbot. É a planilha de segunda-feira, o relatório que alguém monta na mão, o e-mail de cobrança que sai igual todo mês.\n\nRegra simples: se a tarefa é repetitiva, tediosa e acontece toda semana, ela é candidata.", threadParts: [] },
    ],
    sources: [],
  },
};

function fakeAnthropic(): Anthropic {
  return {
    beta: {
      messages: {
        parse: async (params: { messages: { content: string }[] }) => {
          const user = String(params.messages[0]!.content);
          const format = /Formato: (\w+)/.exec(user)?.[1] ?? "carousel";
          const parsed = user.includes("revisor de qualidade")
            ? { score: 8.5, blocking: false, issues: [], fixInstructions: "" }
            : (DRAFTS[format] ?? DRAFTS.carousel);
          return {
            model: "claude-opus-5-5",
            usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            stop_reason: "end_turn",
            stop_details: null,
            parsed_output: parsed,
          };
        },
      },
    },
  } as unknown as Anthropic;
}

const root = await mkdtemp(join(tmpdir(), "jarvis-demo-"));
const dataDir = join(root, "data");
await initData(dataDir);
const store = new FsStore(dataDir, join(root, "previews"));
const budget = new Budget(store);
const llm = new Llm(budget, fakeAnthropic());
const rules = await store.brandRules();
const strategy = await store.strategy();
await store.saveStrategy({ ...strategy, exploration: 0, formatWeights: { ...strategy.formatWeights, carousel: 34, algoviz: 33, text: 33, story: 0 } });

const ctx: Ctx = {
  store,
  budget,
  now: new Date(),
  dryRun: true,
  platforms: ["instagram", "linkedin", "threads", "x"],
  llm: () => llm,
  brand: async () => ({ rules, system: stableSystem(await store.brandBible(), "", rules) }),
  tokens: async () => VisualTokens.parse({ handle: "@caio" }),
};
await produce(ctx, { count: 6 });
await writeFeed(ctx);

const out = resolve("apps/pwa/demo");
await rm(out, { recursive: true, force: true });
await cp(join(dataDir, "pwa"), join(out, "pwa"), { recursive: true });
await cp(join(root, "previews"), join(out, "previews"), { recursive: true });
console.log(`Demo gerada em ${out}`);
