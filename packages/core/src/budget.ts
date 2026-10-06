import { join } from "node:path";
import { z } from "zod";
import type { FsStore } from "./store.ts";

const Ledger = z.record(z.string(), z.number());

export class BudgetExceededError extends Error {}

/**
 * Contador de gasto mensal por provedor (US$). A geração pausa quando o total
 * passa do teto em reais (JARVIS_BUDGET_BRL, padrão R$ 450).
 */
export class Budget {
  constructor(
    private readonly store: FsStore,
    private readonly capBrl = Number(process.env.JARVIS_BUDGET_BRL ?? 450),
    private readonly usdBrl = Number(process.env.JARVIS_USD_BRL ?? 5.5),
    private readonly month = new Date().toISOString().slice(0, 7),
  ) {}

  private get rel(): string {
    return join("metrics", "spend", `${this.month}.json`);
  }

  async ledger(): Promise<Record<string, number>> {
    return (await this.store.exists(this.rel)) ? this.store.readJson(this.rel, Ledger) : {};
  }

  async totalBrl(): Promise<number> {
    const l = await this.ledger();
    return Object.values(l).reduce((a, b) => a + b, 0) * this.usdBrl;
  }

  async add(provider: string, usd: number): Promise<void> {
    const l = await this.ledger();
    l[provider] = Math.round(((l[provider] ?? 0) + usd) * 10000) / 10000;
    await this.store.writeJson(this.rel, l);
  }

  async assertAvailable(): Promise<void> {
    const total = await this.totalBrl();
    if (total >= this.capBrl) {
      throw new BudgetExceededError(`Teto mensal atingido: R$ ${total.toFixed(2)} de R$ ${this.capBrl}`);
    }
  }
}
