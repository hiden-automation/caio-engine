/**
 * Acesso ao caio-data (privado) direto do celular, pela API do GitHub, com um
 * fine-grained PAT restrito a esse repositório (Contents: read & write).
 * O token fica só neste aparelho.
 */
export interface Conn {
  owner: string;
  repo: string;
  token: string;
}

const KEY = "jarvis.conn";

export function loadConn(): Conn | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Conn) : null;
  } catch {
    return null;
  }
}

export function saveConn(conn: Conn | null): void {
  try {
    if (conn) localStorage.setItem(KEY, JSON.stringify(conn));
    else localStorage.removeItem(KEY);
  } catch {
    /* modo privado: segue sem persistir */
  }
}

export class GitHubError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "Token inválido ou expirado" : status === 404 ? "Não encontrado (repo ou permissão)" : `Erro ${status} na API do GitHub`);
  }
}

async function gh(conn: Conn, path: string, init: RequestInit = {}, accept = "application/vnd.github+json"): Promise<Response> {
  const res = await fetch(`https://api.github.com/repos/${conn.owner}/${conn.repo}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${conn.token}`,
      accept,
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new GitHubError(res.status);
  return res;
}

/** Modo demonstração (token "demo"): lê fixtures locais em ./demo, não grava nada. */
const isDemo = (conn: Conn) => conn.token === "demo";

export async function getJson<T>(conn: Conn, path: string, ref = "main"): Promise<T> {
  if (isDemo(conn)) return (await (await fetch(`./demo/${path}`, { cache: "no-store" })).json()) as T;
  const res = await gh(conn, `contents/${path}?ref=${ref}`, {}, "application/vnd.github.raw+json");
  return (await res.json()) as T;
}

const blobCache = new Map<string, Promise<string>>();

/** Imagem/PDF da branch `previews` como object URL (cacheado na sessão). */
export function previewUrl(conn: Conn, path: string, ref = "previews"): Promise<string> {
  if (isDemo(conn)) return Promise.resolve(`./demo/previews/${path}`);
  const key = `${conn.repo}:${ref}:${path}`;
  if (!blobCache.has(key)) {
    blobCache.set(
      key,
      gh(conn, `contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`, {}, "application/vnd.github.raw+json")
        .then((r) => r.blob())
        .then((b) => URL.createObjectURL(b))
        .catch((err: unknown) => {
          blobCache.delete(key);
          throw err;
        }),
    );
  }
  return blobCache.get(key)!;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Cria um arquivo novo no main (decisões nunca sobrescrevem nada). */
export async function createJson(conn: Conn, path: string, value: unknown, message: string): Promise<void> {
  if (isDemo(conn)) {
    console.info("[demo] gravaria", path, value);
    return;
  }
  await gh(conn, `contents/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, content: toBase64(JSON.stringify(value, null, 2) + "\n"), branch: "main" }),
  });
}

export async function checkConn(conn: Conn): Promise<void> {
  if (isDemo(conn)) return;
  await gh(conn, "");
}

// ---- Biblioteca: fotos e vídeos soltos do Caio na branch `library` --------

/** Limite por arquivo (a API de blobs do GitHub aceita até 100 MB, em base64). */
export const MAX_UPLOAD_BYTES = 70 * 1024 * 1024;

export interface LibraryItem {
  path: string;
  size: number;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function safeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-80);
}

/**
 * Sobe vários arquivos num commit só na branch `library` (cria a branch na
 * primeira vez). Sem organização nenhuma: o motor etiqueta depois.
 */
export async function uploadToLibrary(conn: Conn, files: File[], onProgress: (done: number) => void): Promise<number> {
  if (isDemo(conn)) {
    files.forEach((_, i) => onProgress(i + 1));
    return files.length;
  }
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const entries: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const [i, file] of files.entries()) {
    const content = await fileToBase64(file);
    const res = await gh(conn, "git/blobs", { method: "POST", body: JSON.stringify({ content, encoding: "base64" }) });
    const { sha } = (await res.json()) as { sha: string };
    entries.push({ path: `raw/${month}/${stamp}-${i}-${safeName(file.name)}`, mode: "100644", type: "blob", sha });
    onProgress(i + 1);
  }

  let parent: string | null = null;
  let baseTree: string | undefined;
  try {
    const ref = (await (await gh(conn, "git/ref/heads/library")).json()) as { object: { sha: string } };
    parent = ref.object.sha;
    const commit = (await (await gh(conn, `git/commits/${parent}`)).json()) as { tree: { sha: string } };
    baseTree = commit.tree.sha;
  } catch (err) {
    if (!(err instanceof GitHubError && err.status === 404)) throw err;
  }
  const tree = (await (await gh(conn, "git/trees", { method: "POST", body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: entries }) })).json()) as { sha: string };
  const commit = (await (
    await gh(conn, "git/commits", {
      method: "POST",
      body: JSON.stringify({ message: `biblioteca: +${files.length} arquivo(s)`, tree: tree.sha, parents: parent ? [parent] : [] }),
    })
  ).json()) as { sha: string };
  if (parent) await gh(conn, "git/refs/heads/library", { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
  else await gh(conn, "git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/library", sha: commit.sha }) });
  return files.length;
}

export async function listLibrary(conn: Conn): Promise<LibraryItem[]> {
  if (isDemo(conn)) return [];
  try {
    const res = await gh(conn, "git/trees/library?recursive=1");
    const { tree } = (await res.json()) as { tree: { path: string; type: string; size?: number }[] };
    return tree.filter((t) => t.type === "blob" && t.path.startsWith("raw/")).map((t) => ({ path: t.path, size: t.size ?? 0 }));
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return [];
    throw err;
  }
}
