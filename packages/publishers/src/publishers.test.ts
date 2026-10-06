import { describe, expect, it } from "vitest";
import { toLittleText } from "./linkedin.ts";
import { oauth1Header } from "./x.ts";

describe("LinkedIn little text", () => {
  it("escapa reservados e mantém hashtag clicável", () => {
    expect(toLittleText("Automação (de verdade) #IA")).toBe("Automação \\(de verdade\\) {hashtag|\\#|IA}");
  });
});

describe("OAuth 1.0a do X", () => {
  // Vetor de exemplo da documentação oficial do X (Creating a signature).
  it("gera a assinatura esperada", () => {
    const header = oauth1Header(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      {
        apiKey: "xvz1evFS4wEEPTGEFPHBog",
        apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      "1318622958",
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
  });
});
