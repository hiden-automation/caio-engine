import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { log, unguessableName } from "@jarvis/core";

const run = promisify(execFile);

/**
 * caio-cdn: repositório público cujo GitHub Pages serve as mídias só durante a
 * publicação (IG e Threads exigem URL pública). Cada flush é um commit órfão
 * com push --force, então não sobra histórico; depois do post, esvaziamos.
 */
export class CdnStager {
  private staged: string[] = [];

  constructor(
    private readonly dir = resolve(process.env.CDN_DIR ?? "../cdn-out"),
    private readonly baseUrl = process.env.CDN_BASE_URL ?? "",
    private readonly pushUrl = process.env.CDN_PUSH_URL ?? "",
  ) {}

  get configured(): boolean {
    return !!(this.baseUrl && this.pushUrl);
  }

  async stage(localPath: string): Promise<string> {
    const folder = unguessableName();
    await mkdir(join(this.dir, folder), { recursive: true });
    await copyFile(localPath, join(this.dir, folder, basename(localPath)));
    const url = `${this.baseUrl.replace(/\/$/, "")}/${folder}/${basename(localPath)}`;
    this.staged.push(url);
    return url;
  }

  private async git(...args: string[]): Promise<void> {
    try {
      await run("git", ["-C", this.dir, ...args], {
        env: { ...process.env, GIT_AUTHOR_NAME: "jarvis", GIT_AUTHOR_EMAIL: "jarvis@users.noreply.github.com", GIT_COMMITTER_NAME: "jarvis", GIT_COMMITTER_EMAIL: "jarvis@users.noreply.github.com" },
      });
    } catch {
      // A mensagem do git pode conter a URL com token: nunca repassar.
      throw new Error(`git ${args[0]} falhou no caio-cdn`);
    }
  }

  private async pushSnapshot(message: string): Promise<void> {
    await writeFile(join(this.dir, ".nojekyll"), "");
    await writeFile(join(this.dir, "index.html"), "<!doctype html><title>.</title>");
    await rm(join(this.dir, ".git"), { recursive: true, force: true });
    await this.git("init", "-q", "-b", "gh-pages");
    await this.git("add", "-A");
    await this.git("commit", "-q", "-m", message);
    await this.git("push", "-q", "--force", this.pushUrl, "gh-pages");
  }

  /** Publica o que foi preparado e espera o Pages servir todas as URLs. */
  async flush(timeoutMs = 8 * 60_000): Promise<void> {
    if (!this.staged.length) return;
    await this.pushSnapshot("stage");
    const deadline = Date.now() + timeoutMs;
    for (const url of this.staged) {
      for (;;) {
        const res = await fetch(url, { method: "HEAD" }).catch(() => undefined);
        if (res?.ok) break;
        if (Date.now() > deadline) throw new Error("caio-cdn não serviu as mídias a tempo");
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
    log("cdn.ready", { files: this.staged.length });
  }

  async clear(): Promise<void> {
    if (!this.staged.length) return;
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
    await this.pushSnapshot("clear");
    this.staged = [];
    log("cdn.cleared");
  }
}
