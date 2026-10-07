import type { BrandRules, ContentPackage, Format, HookType, Idea, Pillar, Platform, Signal } from "@jarvis/core";
import type { Llm } from "./client.ts";
import { JudgeOutput, TagOutput, TriageOutput, WriterOutput } from "./outputs.ts";
import { FORMAT_SPECS, HOOK_GUIDE, KIND_BY_FORMAT, STYLE_GUIDE, VISUAL_GUIDE } from "./prompts.ts";

export interface BrandContext {
  /** Saída de stableSystem(): idêntica entre chamadas para aproveitar o cache. */
  system: string;
  rules: BrandRules;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export async function triageSignals(llm: Llm, brand: BrandContext, signals: Signal[]): Promise<TriageOutput["items"]> {
  if (!signals.length) return [];
  const list = signals
    .map((s) => `- id=${s.id} | fonte=${s.collector} | ${s.title}${s.summary ? ` (${s.summary})` : ""}`)
    .join("\n");
  const out = await llm.structured({
    role: "triage",
    stableSystem: brand.system,
    schema: TriageOutput,
    user: `Tarefa: triagem de tendências. Para CADA sinal abaixo, avalie se existe um ângulo forte e seguro para o Caio (computação/IA/automação, geek × negócios/computação, bastidores de empreendedor, o próprio JARVIS, ou liberdade/economia/fé pela lente do empreendedor).

Critérios:
- pillarFit alto só se o Caio tem algo específico e interessante a dizer (não basta o tema ser popular).
- risk alto para: tragédias, crimes, fofoca, conteúdo eleitoral direto, temas que exigem reproduzir material protegido, boatos sem fonte.
- angle: a virada do Caio. Ex.: "filme novo da Marvel" → "a IA do vilão explicada por quem programa IA".
- suggestedFormat: um de carousel, algoviz, slideshow (reel animado), text, story (os que existem hoje).

Sinais:
${list}`,
  });
  return out.items.map((i) => ({
    ...i,
    pillarFit: clamp01(i.pillarFit),
    risk: clamp01(i.risk),
    saturation: clamp01(i.saturation),
  }));
}

export interface WriteRequest {
  pillar: Pillar;
  format: Format;
  hookType: HookType;
  exploration: boolean;
  platforms: Platform[];
  idea?: Idea;
  recentTopics: string[];
  /** Dados reais de uma simulação (AlgoViz) que a narração deve citar. */
  simulationData?: string;
  /** Pedido de ajuste do Caio ou instrução do juiz da tentativa anterior. */
  feedback?: string;
  previous?: ContentPackage;
  /** Catálogo da base (fotos/vídeos etiquetados) para escolher mídias pelo id. */
  library?: string;
  /** Estilo obrigatório (teste em massa / rotação); sem isso o roteirista escolhe. */
  style?: "hud" | "post" | "quadro";
  /** Direção extra (ex.: teste em massa: "use o cachorro"). */
  brief?: string;
}

export async function writePackage(llm: Llm, brand: BrandContext, req: WriteRequest): Promise<WriterOutput> {
  const kinds = KIND_BY_FORMAT[req.format] ?? {};
  const platformLines = req.platforms
    .filter((p) => kinds[p])
    .map((p) => `- ${p}: kind "${kinds[p]}"`)
    .join("\n");

  const parts = [
    `Tarefa: criar um pacote de conteúdo.`,
    `Pilar: ${req.pillar}`,
    `Formato: ${req.format}\n${FORMAT_SPECS[req.format] ?? ""}`,
    req.format === "text" ? "" : `${STYLE_GUIDE}${req.style ? `\nESTILO OBRIGATÓRIO: "${req.style}".` : ""}\n\n${VISUAL_GUIDE}`,
    req.format === "text"
      ? ""
      : req.library
        ? `BASE DE MÍDIA DO CAIO (use pelo id; prefira as menos usadas; não force mídia onde não combina, mas um pacote com a cara e a vida real do Caio performa melhor):\n${req.library}`
        : `Base de mídia vazia: não use visuais com L<id>.`,
    req.brief ? `DIREÇÃO ESPECÍFICA DESTE PACOTE: ${req.brief}` : "",
    `Tipo de gancho pedido: ${req.hookType}${req.exploration ? " (rodada de EXPLORAÇÃO: arrisque um ângulo diferente do usual)" : ""}\n${HOOK_GUIDE}`,
    `Gere exatamente uma variante para cada plataforma abaixo, com legenda nativa de cada rede:\n${platformLines}`,
    req.pillar === "geek" ? `Se o tema for Geek × negócios (e não Geek × computação), NÃO gere a variante linkedin.` : "",
    req.idea
      ? `Ideia (vinda do radar de tendências):\nTítulo: ${req.idea.title}\nÂngulo: ${req.idea.angle}\nFontes: ${req.idea.sources.map((s) => `${s.title} ${s.url ?? ""} (licença: ${s.license})`).join("; ") || "nenhuma"}`
      : `Sem ideia pré-definida: escolha um tema forte e atemporal do pilar.`,
    req.simulationData ? `Dados reais da simulação (cite exatamente estes números):\n${req.simulationData}` : "",
    req.recentTopics.length ? `Temas publicados recentemente (não repita):\n${req.recentTopics.slice(0, 30).map((t) => `- ${t}`).join("\n")}` : "",
    req.previous ? `Versão anterior deste pacote (JSON):\n${JSON.stringify({ slides: req.previous.slides, variants: req.previous.variants.map((v) => ({ platform: v.platform, caption: v.caption })) })}` : "",
    req.feedback ? `AJUSTES OBRIGATÓRIOS nesta versão:\n${req.feedback}` : "",
    `Em "sources", liste apenas fontes reais recebidas acima (license "livre", "permitido" ou "citacao"); use [] se não houver.`,
  ];
  return llm.structured({
    role: "writer",
    stableSystem: brand.system,
    schema: WriterOutput,
    user: parts.filter(Boolean).join("\n\n"),
  });
}

export async function judgePackage(llm: Llm, brand: BrandContext, pkg: ContentPackage, images: string[] = []): Promise<JudgeOutput> {
  const payload = {
    pillar: pkg.pillar,
    format: pkg.format,
    hook: pkg.chosenHook,
    style: pkg.style,
    slides: pkg.slides,
    variants: pkg.variants.map((v) => ({ platform: v.platform, kind: v.kind, caption: v.caption, threadParts: v.threadParts })),
    sources: pkg.sources,
  };
  const out = await llm.structured({
    role: "judge",
    stableSystem: brand.system,
    schema: JudgeOutput,
    images,
    user: `Tarefa: você é o revisor de qualidade (QA) antes do conteúdo chegar ao celular do Caio. Seja exigente, como um gestor de social media de marca pessoal.

Avalie:
1. Violação de qualquer regra imutável → blocking = true.
2. Afirmações factuais sem fonte em "sources" → blocking = true.
3. Gancho: o primeiro slide/linha prende em 1 segundo? É específico?
4. Soa como o Caio (bíblia) e não como texto genérico de IA?
5. Cada legenda é nativa da sua rede? Erros de português?
6. Entrega valor real (aprende algo, sente algo, quer salvar/compartilhar)?
7. ${images.length ? "Olhe as imagens renderizadas: texto legível, nada cortado ou sobreposto, hierarquia clara, cara de marca pessoal (não de template genérico)? Problema visual grave → blocking." : "Os visuais escolhidos são variados e fazem sentido?"}

Contexto das artes: as fotos e vídeos da base foram enviados pelo próprio Caio para uso no perfil (detalhes pessoais visíveis nelas não são problema). O nome e o avatar no cabeçalho são a foto real do Caio e vêm da configuração da marca (não avalie como problema); a ausência do @ também é configuração pendente.

score: 0–10. Abaixo de ${brand.rules.minBrandScore} não passa. Em fixInstructions, diga objetivamente o que mudar.

Pacote:
${JSON.stringify(payload, null, 2)}`,
  });
  return { ...out, score: Math.max(0, Math.min(10, out.score)) };
}

export interface MediaToTag {
  id: string;
  kind: "image" | "video";
  /** Foto: 1 arquivo. Vídeo: quadros espalhados. */
  files: string[];
}

/** Etiqueta mídias da base olhando as imagens (visão). */
export async function tagMedia(llm: Llm, brand: BrandContext, items: MediaToTag[]): Promise<TagOutput["items"]> {
  if (!items.length) return [];
  const files: string[] = [];
  const lines = items.map((it) => {
    const refs = it.files.map((f) => {
      files.push(f);
      return `[${files.length}]`;
    });
    return `- id=${it.id} (${it.kind === "video" ? `vídeo, quadros ${refs.join(" ")}` : `foto ${refs[0]}`})`;
  });
  const out = await llm.structured({
    role: "triage",
    stableSystem: brand.system,
    schema: TagOutput,
    images: files,
    user: `Tarefa: etiquetar as mídias que o Caio jogou na base, para o sistema reaproveitar nas artes, stories e reels.
O Caio é o rapaz de cabelo escuro e barba (compare entre as fotos). Ele tem um cachorro (chow-chow).

Para CADA mídia, preencha:
- description: o que aparece, em uma frase objetiva.
- people: caio | caio_e_outros | outros | ninguem.
- hasDog: aparece o cachorro?
- expression: expressão do Caio (pensativo, sério, sorrindo, surpreso, confiante, neutro) ou "-" se ele não aparece.
- setting: estudio, carro, praia, natureza, casa, academia, aquario, cidade, escritorio, outro.
- mood: clima da imagem em 1–3 palavras.
- quality: 0 a 1 (nitidez, luz, enquadramento).
- political: true se há QUALQUER símbolo, número, adesivo ou cor de partido/candidato (estamos em período eleitoral).
- sensitive: true se aparece rosto identificável de outra pessoa, criança, documento, placa de carro, endereço ou tela com dado pessoal.
- uses: avatar (rosto do Caio nítido, de frente), capa (forte para capa de carrossel), fundo (bom fundo para texto por cima), story, reacao (expressão que serve de reação/meme), broll (vídeo bom de fundo para reel), recorte (o recorte do fundo vai ficar LIMPO: sujeito inteiro, bem separado do fundo, sem objetos na frente; selfie em carro, mão cortada ou fundo confuso NÃO).
- focus: ponto de interesse principal (x, y de 0 a 1) para enquadrar cortes.

Mídias:
${lines.join("\n")}`,
  });
  return out.items;
}
