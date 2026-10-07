import { useCallback, useEffect, useMemo, useState } from "react";
import { checkConn, createJson, getJson, loadConn, saveConn, type Conn } from "./github.ts";
import { Library } from "./Library.tsx";
import { PackageCard, Preview, type Decision } from "./PackageCard.tsx";
import { PILLAR_LABEL, PLATFORM_LABEL, type Feed, type PackageSummary } from "./types.ts";

type Tab = "fila" | "agenda" | "base" | "ideias" | "painel";

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

function Agenda({ feed }: { feed: Feed }) {
  const items = feed.scheduled
    .flatMap((p) => p.variants.filter((v) => v.scheduledAt && v.status === "approved").map((v) => ({ p, v })))
    .sort((a, b) => a.v.scheduledAt!.localeCompare(b.v.scheduledAt!));
  const days = new Map<string, typeof items>();
  for (const it of items) {
    const d = fmtDay(it.v.scheduledAt!);
    days.set(d, [...(days.get(d) ?? []), it]);
  }
  return (
    <section className="list">
      {!items.length && <p className="empty">Nada agendado. Aprove algo na fila.</p>}
      {[...days].map(([day, list]) => (
        <div key={day}>
          <h3 className="day">{day}</h3>
          {list.map(({ p, v }) => (
            <div key={`${p.id}-${v.id}`} className="row-item">
              <span className="time">{fmtTime(v.scheduledAt!)}</span>
              <span className="chip">{PLATFORM_LABEL[v.platform]}</span>
              <span className="grow">{p.topic}</span>
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
  const [decided, setDecided] = useState<Set<string>>(new Set());
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
      setDecided(new Set());
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
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  if (!conn) return <Setup onDone={setConn} />;

  async function decide(d: Decision) {
    const at = new Date().toISOString();
    await createJson(conn!, `reviews/${d.packageId}-${Date.now()}.json`, { ...d, at }, `review: ${d.decision} ${d.packageId}`);
    setDecided((s) => new Set(s).add(d.packageId));
    toast(d.decision === "approve" ? "Aprovado ✓ — o motor agenda em instantes" : d.decision === "reject" ? "Rejeitado" : "Ajuste pedido: volta para a fila");
  }

  const pending = feed?.pending.filter((p) => !decided.has(p.id)) ?? [];

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
              <PackageCard key={p.id} conn={conn} pkg={p} onDecide={decide} />
            ))}
            {!!feed.discarded?.length && (
              <details className="discarded">
                <summary>Reprovados pelo revisor ({feed.discarded.length}) — não chegam à fila</summary>
                {feed.discarded.map((d) => (
                  <div key={d.id} className="row-item col">
                    <div className="disc-head">
                      {d.cover && <div className="disc-thumb"><Preview conn={conn} path={d.cover} alt="capa" /></div>}
                      <div>
                        <b>{d.hook || d.topic}</b>
                        <p className="muted small">{d.format} · {d.style} · nota {d.score?.toFixed(1)}</p>
                      </div>
                    </div>
                    <ul className="issues">{d.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
                  </div>
                ))}
              </details>
            )}
          </section>
        )}
        {feed && tab === "agenda" && <Agenda feed={feed} />}
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
        {(["fila", "agenda", "base", "ideias", "painel"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "fila" ? `Fila${pending.length ? ` (${pending.length})` : ""}` : t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
    </div>
  );
}
