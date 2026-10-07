import { describe, expect, it } from "vitest";
import { BrandRules } from "./schemas.ts";
import { canTransition, InvalidTransitionError, transition } from "./state.ts";
import { deterministicIssues } from "./rules.ts";
import { fakePackage } from "./testing.ts";
import { betaSample, mulberry32 } from "./random.ts";

const rules = BrandRules.parse({});

describe("máquina de estados", () => {
  it("segue o caminho feliz até publicado", () => {
    let p = fakePackage({ status: "idea" });
    for (const s of ["scripted", "rendered", "qa_passed", "pending_review", "approved", "scheduled", "publishing", "published"] as const) {
      p = transition(p, s);
    }
    expect(p.status).toBe("published");
    expect(p.history).toHaveLength(8);
  });

  it("bloqueia publicar sem aprovação", () => {
    expect(canTransition("qa_passed", "scheduled")).toBe(false);
    expect(() => transition(fakePackage({ status: "pending_review" }), "publishing")).toThrow(InvalidTransitionError);
  });

  it("agendado pode ser rejeitado e rejeitado pode voltar a ser aprovado", () => {
    const p = transition(fakePackage({ status: "scheduled" }), "rejected", "mudei de ideia");
    expect(transition(p, "approved").status).toBe("approved");
    expect(canTransition("published", "rejected")).toBe(false);
  });

  it("pedido de ajuste volta para o roteirista", () => {
    const p = transition(fakePackage({ status: "pending_review" }), "edit_requested", "mais curto");
    expect(transition(p, "scripted").status).toBe("scripted");
  });
});

describe("regras de marca (QA determinístico)", () => {
  const withCaption = (caption: string) =>
    fakePackage({ variants: [{ ...fakePackage().variants[0]!, caption }] });

  it("reprova faturamento", () => {
    expect(deterministicIssues(withCaption("Esse mês faturei R$ 30 mil com automação"), rules).join()).toMatch(/faturamento/);
  });

  it("reprova resultado de cliente inventado", () => {
    expect(deterministicIssues(withCaption("Meu cliente, o escritório Y, economizou 40h por mês"), rules).join()).toMatch(/cliente/);
  });

  it("reprova número de clientes", () => {
    expect(deterministicIssues(withCaption("Hoje eu atendo 12 clientes"), rules).length).toBeGreaterThan(0);
  });

  it("aceita cenário hipotético e demo real", () => {
    expect(deterministicIssues(withCaption("Como eu automatizaria um escritório de contabilidade"), rules)).toEqual([]);
    expect(deterministicIssues(withCaption("Meu robô processou 312 linhas em 4,2 s na demo"), rules)).toEqual([]);
  });

  it("reprova link no X e legenda longa", () => {
    const p = fakePackage({
      variants: [{ ...fakePackage().variants[0]!, platform: "x", kind: "text", caption: "veja https://x.com " + "a".repeat(300) }],
    });
    const issues = deterministicIssues(p, rules).join("|");
    expect(issues).toMatch(/link/);
    expect(issues).toMatch(/280/);
  });

  it("reprova voz clonada no pilar liberdade", () => {
    const p = fakePackage({ pillar: "liberdade", features: { ...fakePackage().features, pillar: "liberdade", voice: "clone" } });
    expect(deterministicIssues(p, rules).join()).toMatch(/voz clonada/);
  });
});

describe("random", () => {
  it("é determinístico por seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("Beta(8,2) tem média ~0.8", () => {
    const rng = mulberry32(1);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += betaSample(rng, 8, 2);
    expect(sum / 4000).toBeCloseTo(0.8, 1);
  });
});
