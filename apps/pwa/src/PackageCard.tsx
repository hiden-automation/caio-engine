import { useEffect, useRef, useState } from "react";
import { previewUrl, previewUrlProgress, type Conn } from "./github.ts";
import { PILLAR_LABEL, PLATFORM_LABEL, type ContentPackage, type Review } from "./types.ts";

const REJECT_REASONS = ["tema fraco", "fora da marca", "erro factual", "visual ruim", "repetido", "não é a minha opinião"];

export function Preview({ conn, path, alt }: { conn: Conn; path: string; alt: string }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    previewUrl(conn, path)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [conn, path]);
  if (failed) return <div className="img placeholder">não carregou</div>;
  return src ? <img className="img" src={src} alt={alt} /> : <div className="img placeholder shimmer" />;
}

function VideoPreview({ conn, path, poster }: { conn: Conn; path: string; poster?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (!("IntersectionObserver" in window)) return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const [src, setSrc] = useState<string>();
  const [cover, setCover] = useState<string>();
  const [pct, setPct] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!near) return;
    let alive = true;
    setFailed(false);
    if (poster) previewUrl(conn, poster).then((u) => alive && setCover(u)).catch(() => undefined);
    previewUrlProgress(conn, path, (p) => alive && setPct(p))
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [conn, path, poster, attempt, near]);
  if (src) return <video className="img video" src={src} poster={cover} controls playsInline loop preload="metadata" />;
  return (
    <div ref={box} className="img video placeholder" style={cover ? { backgroundImage: `url(${cover})`, backgroundSize: "cover" } : undefined}>
      <div className="vid-status">
        {failed ? (
          <button className="btn" onClick={() => setAttempt((a) => a + 1)}>Não carregou · tentar de novo</button>
        ) : (
          <span>Carregando vídeo… {pct}%</span>
        )}
      </div>
    </div>
  );
}

const FORMAT_LABEL: Record<string, string> = { carousel: "carrossel", slideshow: "reel", story: "story", algoviz: "AlgoViz", text: "texto" };

function timeLeft(iso?: string): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expirado";
  const h = Math.floor(ms / 3_600_000);
  return h >= 24 ? `${Math.floor(h / 24)}d` : h >= 1 ? `${h}h` : `${Math.ceil(ms / 60_000)}min`;
}

export type Decision = Omit<Review, "at">;

/** Onde o card aparece: fila (decidir), agenda (rever/tirar) ou rejeitados (rever/recuperar). */
export type CardMode = "pending" | "scheduled" | "rejected";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

/** Por que o pacote está em Rejeitados. */
function rejectedLabel(pkg: ContentPackage): string {
  const note = [...pkg.history].reverse().find((h) => h.to === pkg.status)?.note;
  if (pkg.status === "expired") return "expirou sem aprovação";
  if (pkg.status === "discarded") return `reprovado pelo revisor${pkg.qa ? ` · nota ${pkg.qa.score.toFixed(1)}` : ""}`;
  return `você rejeitou${note ? `: ${note}` : ""}`;
}

export function PackageCard({ conn, pkg, onDecide, mode: where = "pending" }: { conn: Conn; pkg: ContentPackage; onDecide: (d: Decision) => Promise<void>; mode?: CardMode }) {
  const [tab, setTab] = useState(pkg.variants[0]?.id ?? "");
  const [captions, setCaptions] = useState<Record<string, string>>(() => Object.fromEntries(pkg.variants.map((v) => [v.id, v.caption])));
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(pkg.variants.map((v) => [v.id, true])));
  const [mode, setMode] = useState<"idle" | "reject" | "edit">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);

  const videos = pkg.assets.filter((a) => a.kind === "video").sort((a, b) => a.order - b.order);
  const video = videos[0];
  const images = video ? [] : pkg.assets.filter((a) => a.kind === "image").sort((a, b) => a.order - b.order);
  const posterPath = pkg.assets.find((a) => a.role === "cover")?.path;
  const variant = pkg.variants.find((v) => v.id === tab);
  const left = where === "pending" ? timeLeft(pkg.expiresAt) : null;
  const readOnly = where === "scheduled";
  const canApprove = where !== "scheduled" && (pkg.assets.length > 0 || pkg.format === "text");

  async function decide(d: Omit<Decision, "packageId" | "variantToggles" | "captionEdits" | "schedule">) {
    setBusy(true);
    try {
      const captionEdits = Object.fromEntries(pkg.variants.filter((v) => captions[v.id] !== v.caption).map((v) => [v.id, captions[v.id]!]));
      const variantToggles = Object.fromEntries(pkg.variants.filter((v) => !enabled[v.id]).map((v) => [v.id, false]));
      await onDecide({ packageId: pkg.id, variantToggles, captionEdits, schedule: {}, ...d });
    } finally {
      setBusy(false);
    }
  }

  // Gesto: arrastar o card para a direita aprova, para a esquerda abre a rejeição.
  const ignore = (t: EventTarget) => (t as HTMLElement).closest(".media, textarea, input, button, .tabs");
  const onPointerDown = (e: React.PointerEvent) => {
    if (ignore(e.target)) return;
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const ddx = e.clientX - start.current.x;
    if (Math.abs(ddx) > Math.abs(e.clientY - start.current.y)) setDx(ddx);
  };
  const onPointerUp = () => {
    if (start.current && dx > 120 && !busy && canApprove) void decide({ decision: "approve" });
    else if (start.current && dx < -120 && where !== "rejected") setMode("reject");
    start.current = null;
    setDx(0);
  };

  return (
    <article
      className={`card ${pkg.express ? "express" : ""}`}
      style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <header className="card-head">
        <div className="chips">
          {pkg.express && <span className="chip hot">🔥 tendência</span>}
          <span className="chip">{PILLAR_LABEL[pkg.pillar] ?? pkg.pillar}</span>
          <span className="chip">{FORMAT_LABEL[pkg.format] ?? pkg.format}</span>
          <span className="chip">estilo {pkg.style}</span>
          {pkg.features.series && <span className="chip">{pkg.features.series}</span>}
          {pkg.libraryRefs.length > 0 && <span className="chip ok">base: {pkg.libraryRefs.join(", ")}</span>}
          {!!pkg.features.durationSec && <span className="chip">{Math.round(pkg.features.durationSec)}s</span>}
          {pkg.qa && <span className="chip">QA {pkg.qa.score.toFixed(1)}</span>}
          {left && <span className={`chip ${pkg.express ? "hot" : ""}`}>expira em {left}</span>}
        </div>
        {where === "scheduled" && (
          <div className="chips when">
            {pkg.variants
              .filter((v) => v.scheduledAt && v.status === "approved")
              .map((v) => (
                <span key={v.id} className="chip ok">📅 {PLATFORM_LABEL[v.platform]} · {fmtWhen(v.scheduledAt!)}</span>
              ))}
          </div>
        )}
        {where === "rejected" && <p className="status-bad">{rejectedLabel(pkg)}</p>}
        {where === "rejected" && pkg.status === "discarded" && !!pkg.qa?.issues.length && (
          <ul className="issues">{pkg.qa.issues.slice(0, 4).map((i, k) => <li key={k}>{i}</li>)}</ul>
        )}
        <h2>{pkg.chosenHook || pkg.topic}</h2>
        {pkg.angle && <p className="muted">{pkg.angle}</p>}
      </header>

      {videos.length === 1 && (
        <div className="media single">
          <VideoPreview conn={conn} path={video!.path} poster={posterPath} />
        </div>
      )}
      {videos.length > 1 && (
        <div className="media">
          {videos.map((v) => (
            <VideoPreview key={v.id} conn={conn} path={v.path} poster={v.path.replace(/\.mp4$/, "-capa.jpg")} />
          ))}
        </div>
      )}
      {videos.length > 1 && <p className="hint">{videos.length} stories em sequência · deslize →</p>}
      {images.length > 0 && (
        <div className="media">
          {images.map((a) => (
            <Preview key={a.id} conn={conn} path={a.path} alt={`slide ${a.order + 1}`} />
          ))}
        </div>
      )}
      {images.length > 1 && <p className="hint">{images.length} slides · deslize →</p>}

      <nav className="tabs">
        {pkg.variants.map((v) => (
          <button key={v.id} className={`tab ${tab === v.id ? "on" : ""} ${enabled[v.id] ? "" : "off"}`} onClick={() => setTab(v.id)}>
            {PLATFORM_LABEL[v.platform] ?? v.platform}
          </button>
        ))}
      </nav>

      {variant && (
        <section className="variant">
          <label className="toggle">
            <input type="checkbox" disabled={readOnly} checked={enabled[variant.id]} onChange={(e) => setEnabled({ ...enabled, [variant.id]: e.target.checked })} />
            <span>Publicar no {PLATFORM_LABEL[variant.platform]} ({variant.kind})</span>
          </label>
          {variant.kind !== "story" && (
            <textarea
              readOnly={readOnly}
              value={captions[variant.id]}
              rows={Math.min(12, Math.max(4, Math.ceil((captions[variant.id]?.length ?? 0) / 38)))}
              onChange={(e) => setCaptions({ ...captions, [variant.id]: e.target.value })}
            />
          )}
          <span className="counter">{[...(captions[variant.id] ?? "")].length} caracteres</span>
          {variant.threadParts.map((part, i) => (
            <p key={i} className="thread-part">
              <span className="muted">{i + 2}/</span> {part}
            </p>
          ))}
        </section>
      )}

      {pkg.sources.length > 0 && (
        <details className="sources">
          <summary>Fontes ({pkg.sources.length})</summary>
          {pkg.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer">
              {s.title} · {s.license}
            </a>
          ))}
        </details>
      )}

      {mode === "reject" && (
        <div className="panel">
          <p>Por que rejeitar? (o otimizador aprende com isso)</p>
          <div className="chips">
            {REJECT_REASONS.map((r) => (
              <button key={r} className="chip btn" disabled={busy} onClick={() => decide({ decision: "reject", reason: r })}>
                {r}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => setMode("idle")}>cancelar</button>
        </div>
      )}
      {mode === "edit" && (
        <div className="panel">
          <textarea autoFocus placeholder="O que mudar? Ex.: gancho mais forte, menos slides, tom mais leve…" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          <div className="row">
            <button className="link" onClick={() => setMode("idle")}>cancelar</button>
            <button className="btn primary" disabled={busy || !note.trim()} onClick={() => decide({ decision: "edit", note })}>
              Pedir ajuste
            </button>
          </div>
        </div>
      )}

      {mode === "idle" && where === "pending" && (
        <footer className="actions">
          <button className="btn danger" disabled={busy} onClick={() => setMode("reject")}>Rejeitar</button>
          <button className="btn" disabled={busy} onClick={() => setMode("edit")}>Ajustar</button>
          <button className="btn primary" disabled={busy || !Object.values(enabled).some(Boolean)} onClick={() => decide({ decision: "approve" })}>
            {busy ? "Enviando…" : "Aprovar"}
          </button>
        </footer>
      )}
      {mode === "idle" && where === "scheduled" && (
        <footer className="actions">
          <button className="btn danger" disabled={busy} onClick={() => setMode("reject")}>{busy ? "Enviando…" : "Rejeitar"}</button>
        </footer>
      )}
      {mode === "idle" && where === "rejected" && (
        <footer className="actions">
          {pkg.status === "rejected" && <button className="btn" disabled={busy} onClick={() => setMode("edit")}>Ajustar</button>}
          <button className="btn primary" disabled={busy || !canApprove || !Object.values(enabled).some(Boolean)} onClick={() => decide({ decision: "approve" })}>
            {busy ? "Enviando…" : canApprove ? "Aprovar mesmo assim" : "Sem arte para aprovar"}
          </button>
        </footer>
      )}
    </article>
  );
}
