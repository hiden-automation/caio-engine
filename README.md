# caio-engine — JARVIS

O robô que caça tendências, escreve, desenha, revisa e publica o conteúdo do Caio em Instagram, Threads, LinkedIn e X (TikTok e YouTube no Sprint 2). **Nada vai ao ar sem aprovação no PWA do celular.**

Roda inteiro em **GitHub Actions** (processamento) e **GitHub Pages** (PWA). Três repositórios:

| Repo | Visibilidade | Papel |
|---|---|---|
| `caio-engine` (este) | público | código, workflows, PWA no Pages. Público = minutos de Actions ilimitados + vitrine |
| `caio-data` | **privado** | fila, ideias, marca, métricas; branch `previews` com as artes |
| `caio-cdn` | público | Pages efêmero: serve as imagens só durante a publicação (IG/Threads exigem URL pública) |

## Como funciona

```
tendencias.yml (1h)  → caça sinais → hype score → triagem Claude → ideias (🔥 expressa produz na hora)
produzir.yml (2×/dia) → bandit escolhe pilar/formato/gancho → roteiro → arte (Playwright) → QA → fila
PWA (celular)         → aprovar / ajustar / rejeitar  → grava reviews/ no caio-data → avisa o motor
publicar.yml (15 min) → aplica decisões → agenda nos horários → publica no horário (via caio-cdn)
metricas (1h/diário)  → snapshots 1h·6h·24h·72h·7d → otimizador ajusta strategy.yml dentro de limites
doctor (semanal)      → checa credenciais, renova tokens de 60 dias, orçamento
limpeza (semanal)     → apaga artes antigas e recria a branch previews sem histórico
```

## Pacotes

| Pacote | O que faz |
|---|---|
| `packages/core` | schemas (Zod), máquina de estados, store em arquivos, **regras imutáveis de marca**, teto de gasto |
| `packages/llm` | Claude API (saída estruturada, cache do prompt da marca, fallback de recusa): triagem, roteirista, juiz de QA |
| `packages/trends` | coletores (Google Trends BR, Hacker News, GitHub, Hugging Face, RSS, YouTube, Reddit) + hype score |
| `packages/sims` | simulações determinísticas para o AlgoViz (algoritmo genético nos 30 bairros de SP) |
| `packages/visuals` | Estúdio Visual: templates HTML com os tokens da marca → JPEG (1080×1350 / 1080×1920) + PDF |
| `packages/publishers` | Instagram, Threads, LinkedIn, X (APIs oficiais) |
| `packages/optimizer` | Thompson sampling, score por pacote, `strategy.yml` com limites, alocação diária |
| `apps/cli` | o comando `jarvis` que os workflows chamam |
| `apps/pwa` | o app de aprovação |

## Comandos

```bash
npm run jarvis -- init-data ../caio-data   # estrutura inicial do repo de dados
npm run jarvis -- trends
npm run jarvis -- produce --count 3
npm run jarvis -- reviews
JARVIS_DRY_RUN=1 npm run jarvis -- publish
npm run jarvis -- snapshot
npm run jarvis -- optimize
npm run jarvis -- doctor
npm test            # 35 testes, incluindo o pipeline de ponta a ponta com render real
npm run typecheck
```

Para ver o PWA sem credencial nenhuma:

```bash
npx tsx apps/pwa/scripts/make-demo.ts   # roda o pipeline real com LLM simulado
npm run pwa:dev                         # conecte com "demo/demo" e token "demo"
```

## Configuração (Sprint 0)

### 1. Repositórios
1. Crie `caio-engine` (**público**), `caio-data` (**privado**) e `caio-cdn` (**público**).
2. Suba esta pasta em `caio-engine` e a pasta `../caio-data` em `caio-data`.
3. `caio-engine` → Settings → Pages → Source: **GitHub Actions** (o PWA).
4. `caio-cdn` → crie a branch `gh-pages` com qualquer arquivo e ative Pages a partir dela. A URL fica `https://<usuario>.github.io/caio-cdn`.

### 2. Tokens do GitHub (fine-grained, expiração 90 dias)
| Nome | Repos | Permissões | Onde vai |
|---|---|---|---|
| `DATA_TOKEN` | caio-data, caio-cdn | Contents: read/write | secret do caio-engine |
| `ENGINE_DISPATCH_TOKEN` | caio-engine | Contents: read/write | secret do caio-data |
| `SECRETS_ADMIN_TOKEN` | caio-engine | Secrets: read/write | secret do caio-engine (doctor renova tokens) |
| token do celular | caio-data | Contents: read/write | colado no PWA, fica só no aparelho |

### 3. Variáveis do caio-engine (Settings → Variables)
| Variável | Exemplo |
|---|---|
| `DATA_REPO` | `seuusuario/caio-data` |
| `CDN_REPO` | `seuusuario/caio-cdn` |
| `CDN_BASE_URL` | `https://seuusuario.github.io/caio-cdn` |
| `JARVIS_PLATFORMS` | `instagram,threads,linkedin,x` (ligue só as que já têm credencial) |
| `LINKEDIN_TOKEN_CREATED` | `2026-10-10` (o doctor avisa antes dos 60 dias) |

No `caio-data`, crie a variável `ENGINE_REPO` = `seuusuario/caio-engine`.

### 4. Secrets das plataformas (caio-engine)
| Secret | Como obter |
|---|---|
| `ANTHROPIC_API_KEY` | console da Anthropic |
| `IG_USER_ID`, `IG_TOKEN` | app Meta com **Instagram API com Instagram Login**, conta profissional; você como testador/admin do app em modo dev; token de longa duração |
| `THREADS_USER_ID`, `THREADS_TOKEN` | mesmo app Meta, produto Threads API; token de longa duração |
| `LINKEDIN_PERSON_URN`, `LINKEDIN_TOKEN` | app LinkedIn com o produto "Share on LinkedIn" (escopo `w_member_social`); URN no formato `urn:li:person:XXXX` |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X Developer Console (pay-per-use), app com permissão Read and Write, tokens OAuth 1.0a do seu usuário |
| `YOUTUBE_API_KEY` | opcional (tendências do YouTube); Google Cloud → YouTube Data API v3 |

Peça **já** a auditoria da YouTube Data API e do TikTok Content Posting API: as duas demoram, e sem elas os posts ficam privados.

### 5. Marca
Edite no `caio-data`: `brand/bible.md` (o questionário), `brand/visual-tokens.json` (seu @, cores, fontes) e `trends.yml`.

### 6. Primeira rodada
1. Actions → **doctor** → Run: tudo verde?
2. Actions → **produzir** → Run (count 1).
3. Abra o PWA (`https://<usuario>.github.io/caio-engine/`), conecte o `caio-data` e aprove.
4. Actions → **publicar** → Run com `dry_run=1` para simular; depois `0`.

## Regras que o código garante
- Nada é publicado sem `reviews/` vindo do PWA (máquina de estados bloqueia `qa_passed → scheduled`).
- Regras imutáveis em `packages/core/src/rules.ts`: sem faturamento/renda/número de clientes, sem case ou depoimento de cliente inventado, sem link no X, limites de legenda, pilar "liberdade" sem voz clonada.
- Logs públicos nunca mostram legenda, roteiro, URL de mídia ou token (`packages/core/src/log.ts`).
- Teto de gasto mensal (padrão R$ 450): a geração pausa sozinha.

## O que vem nos próximos sprints
- **Sprint 2:** VoiceReel (voz clonada ElevenLabs + legenda karaokê), slideshow, publicadores YouTube/TikTok, Web Push, benchmark de criadores, TikTok Creative Center, biblioteca inteligente, Oficina v1, AlgoViz em vídeo.
- **Sprint 3:** react/split-screen com reações mineradas, cortes com crop de rosto, runner self-hosted de ingestão.
- **Sprint 4:** aprovação das propostas do otimizador no PWA, A/B de ganchos com Trial Reels, playbook semanal, engajamento e "comenta e recebe".
