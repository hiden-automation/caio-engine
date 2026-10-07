import { useCallback, useEffect, useMemo, useState } from "react";
import { checkConn, createJson, getJson, loadConn, saveConn, type Conn } from "./github.ts";
import { Library } from "./Library.tsx";
import { PackageCard, type CardMode, type Decision } from "./PackageCard.tsx";
import { PILLAR_LABEL, PLATFORM_LABEL, type ContentPackage, type Feed, type PackageSummary } from "./types.ts";

type Tab = "fila" | "agenda" | "rejeitados" | "base" | "ideias" | "painel";
const TAB_LABEL: Record<Tab, string> = { fila: "Fila", agenda: "Agenda", rejeitados: "Rejeitados", base: "Base", ideias: "Ideias", painel: "Painel" };

type OnDecide = (d: Decision, from: CardMode) => Promise<void>;

const DECIDED_KEY = "jarvis.decided";
const DECIDED_TTL = 30 * 60_000;

function loadDecided(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DECIDED_KEY) ?? "{}") as Record<string, number>;
    return new Set(Object.entries(raw).filter(([, at]) => Date.now() - at < DECIDED_TTL).map(([id]) => id));
  } catch {
    return new Set();
  }
}

function saveDecided(ids: Set<string>): void {
  try {
    const raw = JSON.parse(localStorage.getItem(DECIDED_KEY) ?? "{}") as Record<string, number>;
    const next = Object.fromEntries([...ids].map((id) => [id, raw[id] ?? Date.now()]));
    localStorage.setItem(DECIDED_KEY, JSON.stringify(next));
  } catch {
    /* sem armazenamento: só perde a memória entre aberturas */
  }
}

function Setup({ onDone }: { onDone: (c: Conn) => void }) {
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const [owner, name] = repo.trim().split("/");
    if (!owner || !name) return setError("Use o formato usuario/caio-data");
    const conn = { owner, repo: name, token: token.trim() };
    setBusy(true);
    try {
      await checkConn(conn);
      saveConn(conn);
      onDone(conn);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="setup" onSubmit={submit}>
      <h1>JARVIS</h1>
      <p className="muted">Conecte o repositório privado de dados. O token fica só neste aparelho.</p>
      <label>
        Repositório de dados
        <input placeholder="usuario/caio-data" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" />
      </label>
      <label>
        Fine-grained token (só caio-data, Contents: leitura e escrita)
        <input type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? "Verificando…" : "Conectar"}</button>
    </form>
  );
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function firstSlot(p: ContentPackage): string {
  return p.variants.filter((v) => v.scheduledAt && v.status === "approved").map((v) => v.scheduledAt!).sort()[0] ?? "";
}

function Agenda({ feed, conn, hidden, onDecide }: { feed: Feed; conn: Conn; hidden: Set<string>; onDecide: OnDecide }) {
  const items = feed.scheduled.filter((p) => firstSlot(p) && !hidden.has(`scheduled:${p.id}`)).sort((a, b) => firstSlot(a).localeCompare(firstSlot(b)));
  const days = new Map<string, ContentPackage[]>();
  for (const p of items) {
    const d = fmtDay(firstSlot(p));
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  return (
    <section className="list">
      {!items.length && <p className="empty">Nada agendado. Aprove algo na fila.</p>}
      {[...days].map(([day, list]) => (
        <div key={day} className="list">
          <h3 className="day">{day}</h3>
          {list.map((p) => (
            <div key={p.id} className="list">
              <p className="slot-time">{fmtTime(firstSlot(p))}</p>
              <PackageCard conn={conn} pkg={p} mode="scheduled" onDecide={(d) => onDecide(d, "scheduled")} />
            </div>
          ))}
        </div>
      ))}
      <h3 className="day">Publicados recentemente</h3>
      {feed.published.map((p: PackageSummary) => (
        <div key={p.id} className="row-item col">
          <span className="grow">{p.topic}</span>
          <span className="links">
            {p.variants.map((v) =>
              v.permalink ? (
                <a key={v.id} href={v.permalink} target="_blank" rel="noreferrer" className="chip ok">{PLATFORM_LABEL[v.platform]} ↗</a>
              ) : (
                <span key={v.id} className={`chip ${v.status === "failed" ? "bad" : ""}`} title={v.error}>
                  {PLATFORM_LABEL[v.platform]} {v.status === "failed" ? "✕" : v.status === "published" ? "✓" : ""}
                </span>
              ),
            )}
          </span>
        </div>
      ))}
    </section>
  );
}

function Rejected({ feed, conn, hidden, onDecide }: { feed: Feed; conn: Conn; hidden: Set<string>; onDecide: OnDecide }) {
  const all = (feed.rejected ?? []).filter((p) => !hidden.has(`rejected:${p.id}`));
  const groups: [string, string, ContentPackage[]][] = [
    ["Rejeitados por você", "", all.filter((p) => p.status === "rejected")],
    ["Expiraram sem aprovação", "", all.filter((p) => p.status === "expired")],
    ["Reprovados pelo revisor", "O revisor automático barrou antes da fila. Se discordar, aprove mesmo assim.", all.filter((p) => p.status === "discarded")],
  ];
  return (
    <section className="list">
      {!all.length && <p className="empty">Nada rejeitado nos últimos 14 dias.</p>}
      {groups
        .filter(([, , list]) => list.length)
        .map(([title, hint, list]) => (
          <details key={title} className="group" open={title === groups[0]![0]}>
            <summary className="day">{title} ({list.length})</summary>
            <div className="list">
              {hint && <p className="muted small">{hint}</p>}
              {list.map((p) => (
                <PackageCard key={p.id} conn={conn} pkg={p} mode="rejected" onDecide={(d) => onDecide(d, "rejected")} />
              ))}
            </div>
          </details>
        ))}
    </section>
  );
}

function Ideas({ conn, initial, toast }: { conn: Conn; initial: { text: string; url: string }; toast: (m: string) => void }) {
  const [text, setText] = useState(initial.text);
  const [url, setUrl] = useState(initial.url);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const at = new Date().toISOString();
      await createJson(conn, `inbox/${at.replace(/[:.]/g, "-")}.json`, { at, text: text.trim(), url: url.trim() || undefined }, "ideia: caixa de entrada");
      setText("");
      setUrl("");
      toast("Ideia enviada. Entra na próxima rodada do caçador.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="list">
      <p className="muted">Jogue aqui um link ou uma ideia solta. O caçador de tendências avalia e, se tiver ângulo, vira pacote.</p>
      <textarea placeholder="Ideia, opinião, tema…" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <input placeholder="Link (opcional)" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
      <button className="btn primary" disabled={busy || (!text.trim() && !url.trim())} onClick={send}>
        {busy ? "Enviando…" : "Enviar para o JARVIS"}
      </button>
    </section>
  );
}

function Panel({ feed, onLogout }: { feed: Feed; onLogout: () => void }) {
  const cap = 450;
  return (
    <section className="list">
      <div className="stats-grid">
        <div className="stat"><b>{feed.counts.pending_review ?? 0}</b><span>na fila</span></div>
        <div className="stat"><b>{feed.counts.scheduled ?? 0}</b><span>agendados</span></div>
        <div className="stat"><b>{feed.counts.published ?? 0}</b><span>publicados</span></div>
        <div className="stat"><b>R$ {feed.spendBrl.toFixed(0)}</b><span>gasto no mês</span></div>
      </div>
      <div className="meter"><div style={{ width: `${Math.min(100, (feed.spendBrl / cap) * 100)}%` }} /></div>
      <p className="muted small">Teto: R$ {cap}. Ao atingir, a geração pausa sozinha.</p>

      <h3 className="day">Mix de pilares (estratégia v{feed.strategy.version})</h3>
      {Object.entries(feed.strategy.pillarMix).map(([k, v]) => (
        <div key={k} className="bar-row">
          <span>{PILLAR_LABEL[k] ?? k}</span>
          <div className="bar"><div style={{ width: `${v}%` }} /></div>
          <span className="num">{v.toFixed(0)}%</span>
        </div>
      ))}

      {feed.proposals && feed.proposals.proposals.length > 0 && (
        <>
          <h3 className="day">Propostas do otimizador</h3>
          {feed.proposals.proposals.map((p, i) => (
            <div key={i} className="row-item">
              <span className="grow">{p.dimension}: {PILLAR_LABEL[p.key] ?? p.key}</span>
              <span className="muted">{p.current.toFixed(0)} → {p.target.toFixed(0)} (aplicado {p.applied.toFixed(0)})</span>
            </div>
          ))}
        </>
      )}

      <h3 className="day">Saúde</h3>
      {feed.health?.checks.map((c) => (
        <div key={c.name} className="row-item">
          <span className={`dot ${c.ok ? "ok" : "bad"}`} />
          <span className="grow">{c.name}</span>
          <span className="muted small">{c.detail}</span>
        </div>
      )) ?? <p className="muted">Rode o workflow doctor.</p>}
      <p className="muted small">Atualizado: {new Date(feed.generatedAt).toLocaleString("pt-BR")}</p>
      <button className="link" onClick={onLogout}>Desconectar este aparelho</button>
    </section>
  );
}

export function App() {
  const [conn, setConn] = useState<Conn | null>(() => loadConn());
  const shared = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return { text: [q.get("share_title"), q.get("share_text")].filter(Boolean).join(" — "), url: q.get("share_url") ?? "" };
  }, []);
  const [tab, setTab] = useState<Tab>(shared.text || shared.url ? "ideias" : "fila");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Decisões enviadas há pouco: o card some na hora, mesmo antes do motor processar.
  const [decided, setDecidedRaw] = useState<Set<string>>(() => loadDecided());
  const setDecided = (fn: Set<string> | ((s: Set<string>) => Set<string>)) =>
    setDecidedRaw((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      saveDecided(next);
      return next;
    });
  const [msg, setMsg] = useState("");

  const toast = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3500);
  }, []);

  const refresh = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    try {
      setFeed(await getJson<Feed>(conn, "pwa/feed.json"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falhou");
    } finally {
      setLoading(false);
    }
  }, [conn]);

  useEffect(() => {
    void refresh();
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    // Com o app aberto, atualiza a cada 2 min (produção nova, decisões aplicadas).
    const timer = setInterval(() => document.visibilityState === "visible" && void refresh(), 120_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(timer);
    };
  }, [refresh]);

  if (!conn) return <Setup onDone={setConn} />;

  async function decide(d: Decision, from: CardMode = "pending") {
    // A lista pode estar velha (app aberto há horas): confere antes de gravar a decisão.
    const fresh = await getJson<Feed>(conn!, "pwa/feed.json");
    const list = from === "pending" ? fresh.pending : from === "scheduled" ? fresh.scheduled : (fresh.rejected ?? []);
    if (!list.some((p) => p.id === d.packageId)) {
      setFeed(fresh);
      toast(from === "scheduled" ? "Esse post já saiu da agenda (foi publicado ou mudou). Atualizei a lista." : "Esse pacote mudou de lugar desde a última atualização. Atualizei a lista.");
      return;
    }
    const at = new Date().toISOString();
    await createJson(conn!, `reviews/${d.packageId}-${Date.now()}.json`, { ...d, at }, `review: ${d.decision} ${d.packageId}`);
    setDecided((s) => new Set(s).add(`${from}:${d.packageId}`));
    toast(
      d.decision === "approve"
        ? from === "rejected" ? "Recuperado ✓ — entra na agenda em instantes" : "Aprovado ✓ — o motor agenda em instantes"
        : d.decision === "reject"
          ? from === "scheduled" ? "Tirado da agenda. Fica em Rejeitados se mudar de ideia." : "Rejeitado. Fica em Rejeitados se mudar de ideia."
          : "Ajuste pedido: volta para a fila",
    );
  }

  const pending = feed?.pending.filter((p) => !decided.has(`pending:${p.id}`) && !decided.has(p.id)) ?? [];

  return (
    <div className="app">
      <header className="top">
        <span className="logo">JARVIS</span>
        <button className="link" onClick={() => void refresh()} disabled={loading}>{loading ? "…" : "↻"}</button>
      </header>
      {error && <p className="error">{error}</p>}
      <main>
        {!feed && !error && <p className="empty">Carregando…</p>}
        {feed && tab === "fila" && (
          <section className="list">
            {pending.length === 0 && <p className="empty">Fila zerada. O JARVIS produz duas vezes por dia.</p>}
            {pending.map((p) => (
              <PackageCard key={p.id} conn={conn} pkg={p} onDecide={(d) => decide(d, "pending")} />
            ))}
          </section>
        )}
        {feed && tab === "agenda" && <Agenda feed={feed} conn={conn} hidden={decided} onDecide={decide} />}
        {feed && tab === "rejeitados" && <Rejected feed={feed} conn={conn} hidden={decided} onDecide={decide} />}
        {tab === "base" && <Library conn={conn} toast={toast} />}
        {tab === "ideias" && <Ideas conn={conn} initial={shared} toast={toast} />}
        {feed && tab === "painel" && (
          <Panel
            feed={feed}
            onLogout={() => {
              saveConn(null);
              setConn(null);
            }}
          />
        )}
      </main>
      {msg && <div className="toast">{msg}</div>}
      <nav className="bottom">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>
    </div>
  );
}
