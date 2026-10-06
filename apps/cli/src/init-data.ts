import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { BrandRules } from "@jarvis/core";
import { defaultStrategy } from "@jarvis/optimizer";
import { TrendsConfig } from "@jarvis/trends";
import { DEFAULT_TOKENS } from "@jarvis/visuals";

const BIBLE = `# Bíblia da marca — Caio

> Rascunho inicial. O questionário do Sprint 0 (por áudio ou texto no PWA) completa e corrige este arquivo.
> Tudo aqui é lido pelo roteirista e pelo QA em toda geração.

## Quem é
- 25 anos, São Paulo capital.
- Formado em computação. Dono de uma empresa de um homem só que cria automações para pequenas e médias empresas.
- Cristão, conservador, de direita. Caseiro. Nerd assumido: Harry Potter, Marvel, Star Wars, negócios, tecnologia.
- Treina na academia (tenta manter constância; vai pelo menos 3x por semana — e admite quando falha).

## Tese
"O jovem que automatiza negócios (e a própria vida) com IA."
O próprio sistema que posta o conteúdo (o JARVIS) é prova de competência e série de conteúdo.

## Como fala
- Primeira pessoa, direto, específico. Explica coisa difícil de um jeito simples, sem infantilizar.
- Humor leve e referências geek naturais (não forçadas).
- Opinião firme, com argumento. Não fica em cima do muro, mas não ataca pessoas.
- Evita jargão de "guru": nada de "mindset", "escala exponencial", "renda passiva", promessas de dinheiro fácil.

## Bordões e expressões (preencher)
- (ex.: "bora automatizar isso?")

## Valores
- Fé, família, trabalho honesto, liberdade econômica, responsabilidade individual.

## Limites
- Nunca falar de faturamento, quanto ganha ou número de clientes.
- Nunca inventar case, cliente ou depoimento.
- Assuntos pessoais (família, namoro, onde mora): só com autorização explícita do Caio.
- Política sempre pela lente do empreendedor; sem ataque pessoal; sem pedir voto.
`;

const BANNED = {
  forbiddenTopics: [
    "tragédias, crimes e mortes",
    "fofoca de celebridades",
    "ataques pessoais a políticos ou qualquer pessoa",
    "pedido de voto ou propaganda eleitoral",
    "orientação médica ou de saúde",
    "promessas de dinheiro fácil ou renda passiva",
    "a vida pessoal do Caio (família, namoro) sem autorização",
  ],
  forbiddenPatterns: [],
  noClonedVoicePillars: ["liberdade"],
  maxThirdPartyRatio: 0.4,
  minBrandScore: 7,
};

const TRENDS = {
  rss: [
    { name: "g1-tecnologia", url: "https://g1.globo.com/rss/g1/tecnologia/", tags: ["tech", "noticia"] },
    { name: "g1-economia", url: "https://g1.globo.com/rss/g1/economia/", tags: ["economia", "noticia"] },
    { name: "tecnoblog", url: "https://tecnoblog.net/feed/", tags: ["tech"] },
    { name: "canaltech", url: "https://canaltech.com.br/rss/", tags: ["tech"] },
    { name: "infomoney", url: "https://www.infomoney.com.br/feed/", tags: ["economia", "negocios"] },
    { name: "poder360", url: "https://www.poder360.com.br/feed/", tags: ["politica"] },
    { name: "revista-oeste", url: "https://revistaoeste.com/feed/", tags: ["politica"] },
    { name: "brazil-journal", url: "https://braziljournal.com/feed/", tags: ["negocios"] },
  ],
  reddit: [],
  youtubeKeywords: ["automação", "inteligência artificial", "n8n", "algoritmo genético", "empreendedorismo", "chatgpt"],
  googleTrendsGeo: "BR",
  hackerNews: true,
  githubTrending: true,
  huggingFace: true,
  triageTopN: 40,
  ideaThreshold: 0.45,
};

const SOURCES = {
  sources: [
    { name: "TV Câmara", url: "https://www.camara.leg.br/tv", license: "livre", note: "conteúdo público; citar a fonte" },
    { name: "TV Senado", url: "https://www12.senado.leg.br/tv", license: "livre", note: "conteúdo público; citar a fonte" },
    { name: "Agência Brasil", url: "https://agenciabrasil.ebc.com.br", license: "livre", note: "CC BY 3.0 BR; crédito obrigatório" },
    { name: "NASA", url: "https://images.nasa.gov", license: "livre", note: "domínio público" },
  ],
};

const README = `# caio-data (PRIVADO)

Banco de dados do JARVIS em arquivos. O motor (caio-engine) lê e escreve aqui pelos workflows; o PWA lê e grava decisões em \`reviews/\` pela API do GitHub.

| Pasta/arquivo | O que é |
|---|---|
| \`brand/\` | bíblia da marca, regras (banned.yml), tokens visuais, playbook |
| \`strategy.yml\` | mix de pilares, formatos, horários — o otimizador ajusta |
| \`strategy-proposals.json\` | mudanças grandes que esperam sua aprovação |
| \`trends.yml\` / \`trends/\` | o que o caçador monitora / sinais coletados |
| \`ideas/\` | ideias com hype score |
| \`queue/\` | pacotes de conteúdo (um JSON por pacote) |
| \`reviews/\` | decisões do PWA (aprovar, rejeitar, ajustar) |
| \`metrics/\` | snapshots de desempenho e gasto do mês |
| branch \`previews\` | imagens/PDFs gerados (o PWA mostra daqui) |
`;

const DISPATCH_WORKFLOW = `name: avisar-motor
# Quando o PWA grava uma decisão, acorda o caio-engine na hora.
on:
  push:
    branches: [main]
    paths: ["reviews/*.json", "strategy-decisions/*.json"]
permissions: {}
jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: repository_dispatch → caio-engine
        env:
          GH_TOKEN: \${{ secrets.ENGINE_DISPATCH_TOKEN }}
          ENGINE_REPO: \${{ vars.ENGINE_REPO }}
        run: gh api "repos/$ENGINE_REPO/dispatches" -f event_type=review
`;

async function put(root: string, rel: string, content: string, force: boolean): Promise<void> {
  const full = join(root, rel);
  if (!force) {
    try {
      await access(full);
      console.log(`  mantido  ${rel}`);
      return;
    } catch {
      /* não existe: cria */
    }
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
  console.log(`  criado   ${rel}`);
}

/** Cria a estrutura inicial do repositório caio-data (não sobrescreve sem --force). */
export async function initData(root: string, force = false): Promise<void> {
  await put(root, "README.md", README, force);
  await put(root, "brand/bible.md", BIBLE, force);
  await put(root, "brand/playbook.md", "# Playbook\n\n(Vazio: o otimizador preenche toda semana a partir das métricas.)\n", force);
  await put(root, "brand/banned.yml", YAML.stringify(BrandRules.parse(BANNED)), force);
  await put(root, "brand/visual-tokens.json", JSON.stringify({ ...DEFAULT_TOKENS, handle: "@seu.handle" }, null, 2) + "\n", force);
  await put(root, "strategy.yml", YAML.stringify(defaultStrategy()), force);
  await put(root, "trends.yml", YAML.stringify(TrendsConfig.parse(TRENDS)), force);
  await put(root, "sources.yml", YAML.stringify(SOURCES), force);
  await put(root, "benchmarks.yml", "# Criadores de referência (Sprint 2): handle, plataforma, nicho\ncreators: []\n", force);
  for (const dir of ["queue", "ideas", "reviews", "inbox", "pwa", "trends", "metrics/snapshots", "reports"]) await put(root, `${dir}/.gitkeep`, "", false);
  await put(root, ".github/workflows/avisar-motor.yml", DISPATCH_WORKFLOW, force);
}
