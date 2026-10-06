import { useCallback, useEffect, useState } from "react";
import { listLibrary, MAX_UPLOAD_BYTES, previewUrl, uploadToLibrary, type Conn, type LibraryItem } from "./github.ts";

const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

function Thumb({ conn, item }: { conn: Conn; item: LibraryItem }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (!IMAGE.test(item.path) || item.size > 8 * 1024 * 1024) return;
    let alive = true;
    previewUrl(conn, item.path, "library").then((u) => alive && setSrc(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [conn, item]);
  const name = item.path.split("/").pop()!.replace(/^\d+-\d+-/, "");
  return src ? <img className="thumb" src={src} alt={name} /> : <div className="thumb file">{/\.(mp4|mov|m4v|webm)$/i.test(name) ? "🎬" : "📄"}<span>{name}</span></div>;
}

/**
 * "Jogar na base": fotos e vídeos soltos, sem organizar nada. O motor
 * etiqueta, recorta e reaproveita depois.
 */
export function Library({ conn, toast }: { conn: Conn; toast: (m: string) => void }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await listLibrary(conn)).reverse());
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falhou ao listar");
    }
  }, [conn, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const all = [...(e.target.files ?? [])];
    e.target.value = "";
    const big = all.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const files = all.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (big.length) toast(`${big.length} arquivo(s) acima de 70 MB ficaram de fora (corte o vídeo em trechos menores)`);
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    try {
      // Lotes pequenos: se a conexão cair, o que já subiu fica salvo.
      for (let i = 0; i < files.length; i += 5) {
        const batch = files.slice(i, i + 5);
        await uploadToLibrary(conn, batch, (d) => setProgress({ done: i + d, total: files.length }));
      }
      toast(`${files.length} arquivo(s) na base ✓`);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falhou o envio");
    } finally {
      setProgress(null);
    }
  }

  const totalMb = (items ?? []).reduce((a, b) => a + b.size, 0) / 1024 / 1024;

  return (
    <section className="list">
      <p className="muted">Foto de passeio, vídeo fazendo caras e bocas, academia… qualquer coisa. Não precisa organizar.</p>
      <label className={`btn primary upload ${progress ? "disabled" : ""}`}>
        {progress ? `Enviando ${progress.done}/${progress.total}…` : "Jogar fotos e vídeos"}
        <input type="file" accept="image/*,video/*" multiple hidden disabled={!!progress} onChange={onPick} />
      </label>
      <p className="muted small">
        {items === null ? "Carregando…" : `${items.length} arquivo(s) · ${totalMb.toFixed(0)} MB na base`} · até 70 MB por arquivo
      </p>
      <div className="grid">
        {(items ?? []).slice(0, 60).map((it) => (
          <Thumb key={it.path} conn={conn} item={it} />
        ))}
      </div>
    </section>
  );
}
