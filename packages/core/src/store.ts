import { mkdir, readFile, readdir, rename, writeFile, access, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import {
  BrandRules,
  ContentPackage,
  Idea,
  LibraryItem,
  MetricSnapshot,
  Review,
  Signal,
  Strategy,
  type PackageStatus,
} from "./schemas.ts";

/**
 * Acesso ao repositório caio-data clonado no runner (DATA_DIR).
 * Os workflows fazem checkout, o CLI lê/escreve arquivos e o workflow
 * commita no final — simples, auditável e com histórico no git.
 */
export class FsStore {
  constructor(
    readonly dataDir: string,
    readonly previewsDir: string = join(dataDir, "..", "previews"),
  ) {}

  path(rel: string): string {
    return join(this.dataDir, rel);
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await access(this.path(rel));
      return true;
    } catch {
      return false;
    }
  }

  async readText(rel: string): Promise<string> {
    return readFile(this.path(rel), "utf8");
  }

  async writeText(rel: string, content: string): Promise<void> {
    const full = this.path(rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  async readJson<S extends z.ZodType>(rel: string, schema: S): Promise<z.infer<S>> {
    return schema.parse(JSON.parse(await this.readText(rel)));
  }

  async writeJson(rel: string, value: unknown): Promise<void> {
    await this.writeText(rel, JSON.stringify(value, null, 2) + "\n");
  }

  async readYaml<S extends z.ZodType>(rel: string, schema: S): Promise<z.infer<S>> {
    return schema.parse(YAML.parse(await this.readText(rel)));
  }

  async writeYaml(rel: string, value: unknown): Promise<void> {
    await this.writeText(rel, YAML.stringify(value));
  }

  async list(dirRel: string, ext = ".json"): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(this.path(rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const child = join(rel, e.name);
        if (e.isDirectory()) await walk(child);
        else if (e.name.endsWith(ext)) out.push(child);
      }
    };
    await walk(dirRel);
    return out.sort();
  }

  // ---- marca e estratégia -------------------------------------------------

  brandBible(): Promise<string> {
    return this.readText("brand/bible.md");
  }

  async playbook(): Promise<string> {
    return (await this.exists("brand/playbook.md")) ? this.readText("brand/playbook.md") : "";
  }

  brandRules(): Promise<BrandRules> {
    return this.readYaml("brand/banned.yml", BrandRules);
  }

  strategy(): Promise<Strategy> {
    return this.readYaml("strategy.yml", Strategy);
  }

  saveStrategy(s: Strategy): Promise<void> {
    return this.writeYaml("strategy.yml", Strategy.parse(s));
  }

  // ---- pacotes ------------------------------------------------------------

  private packageRel(pkg: Pick<ContentPackage, "id" | "createdAt">): string {
    return join("queue", pkg.createdAt.slice(0, 7), `${pkg.id}.json`);
  }

  savePackage(pkg: ContentPackage): Promise<void> {
    return this.writeJson(this.packageRel(pkg), ContentPackage.parse(pkg));
  }

  async listPackages(statuses?: PackageStatus[]): Promise<ContentPackage[]> {
    const files = await this.list("queue");
    const pkgs = await Promise.all(files.map((f) => this.readJson(f, ContentPackage)));
    return statuses ? pkgs.filter((p) => statuses.includes(p.status)) : pkgs;
  }

  async loadPackage(id: string): Promise<ContentPackage | undefined> {
    return (await this.listPackages()).find((p) => p.id === id);
  }

  // ---- base de mídia ("jogar na base") -------------------------------------

  async library(): Promise<LibraryItem[]> {
    if (!(await this.exists("library/index.json"))) return [];
    return (JSON.parse(await this.readText("library/index.json")) as unknown[]).map((i) => LibraryItem.parse(i));
  }

  saveLibrary(items: LibraryItem[]): Promise<void> {
    return this.writeJson("library/index.json", items.map((i) => LibraryItem.parse(i)));
  }

  async libraryMeta(): Promise<{ avatar?: string; avatarFrom?: string }> {
    return (await this.exists("library/meta.json")) ? (JSON.parse(await this.readText("library/meta.json")) as { avatar?: string; avatarFrom?: string }) : {};
  }

  saveLibraryMeta(meta: { avatar?: string; avatarFrom?: string }): Promise<void> {
    return this.writeJson("library/meta.json", meta);
  }

  // ---- ideias e sinais ----------------------------------------------------

  saveIdea(idea: Idea): Promise<void> {
    return this.writeJson(join("ideas", idea.createdAt.slice(0, 7), `${idea.id}.json`), Idea.parse(idea));
  }

  async listIdeas(status?: Idea["status"]): Promise<Idea[]> {
    const files = await this.list("ideas");
    const ideas = await Promise.all(files.map((f) => this.readJson(f, Idea)));
    return status ? ideas.filter((i) => i.status === status) : ideas;
  }

  async loadSignals(day: string): Promise<Signal[]> {
    const rel = join("trends", `${day}.json`);
    if (!(await this.exists(rel))) return [];
    return (JSON.parse(await this.readText(rel)) as unknown[]).map((s) => Signal.parse(s));
  }

  saveSignals(day: string, signals: Signal[]): Promise<void> {
    return this.writeJson(join("trends", `${day}.json`), signals);
  }

  // ---- revisões vindas do PWA ---------------------------------------------

  async pendingReviews(): Promise<{ file: string; review: Review }[]> {
    const files = (await this.list("reviews")).filter((f) => !f.includes("processed"));
    return Promise.all(files.map(async (file) => ({ file, review: await this.readJson(file, Review) })));
  }

  async archiveReview(file: string): Promise<void> {
    const target = this.path(join("reviews", "processed", file.split(/[\\/]/).pop()!));
    await mkdir(dirname(target), { recursive: true });
    await rename(this.path(file), target);
  }

  // ---- métricas ------------------------------------------------------------

  async appendSnapshots(snaps: MetricSnapshot[]): Promise<void> {
    if (!snaps.length) return;
    const rel = join("metrics", "snapshots", `${snaps[0]!.takenAt.slice(0, 7)}.jsonl`);
    await mkdir(dirname(this.path(rel)), { recursive: true });
    await appendFile(this.path(rel), snaps.map((s) => JSON.stringify(MetricSnapshot.parse(s))).join("\n") + "\n");
  }

  async loadSnapshots(): Promise<MetricSnapshot[]> {
    const files = await this.list(join("metrics", "snapshots"), ".jsonl");
    const out: MetricSnapshot[] = [];
    for (const f of files) {
      for (const line of (await this.readText(f)).split("\n")) {
        if (line.trim()) out.push(MetricSnapshot.parse(JSON.parse(line)));
      }
    }
    return out;
  }
}
