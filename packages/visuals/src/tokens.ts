import { z } from "zod";

/** `brand/visual-tokens.json` no caio-data. Toda arte sai destes tokens. */
export const VisualTokens = z.object({
  name: z.string().default("Caio"),
  /** Nome que aparece no cabeçalho de toda arte, ao lado do avatar. */
  displayName: z.string().default("Caio Vilor"),
  /** Selo azul ao lado do nome (estético). */
  verified: z.boolean().default(false),
  handle: z.string().default("@caio"),
  colors: z
    .object({
      bg: z.string().default("#0B0F17"),
      surface: z.string().default("#141B27"),
      fg: z.string().default("#F2F4F8"),
      muted: z.string().default("#8A94A6"),
      accent: z.string().default("#3DDC97"),
      accent2: z.string().default("#FFB547"),
      danger: z.string().default("#FF5C7A"),
    })
    .default({
      bg: "#0B0F17",
      surface: "#141B27",
      fg: "#F2F4F8",
      muted: "#8A94A6",
      accent: "#3DDC97",
      accent2: "#FFB547",
      danger: "#FF5C7A",
    }),
  fonts: z
    .object({
      display: z.string().default("Space Grotesk"),
      body: z.string().default("Inter"),
      mono: z.string().default("JetBrains Mono"),
    })
    .default({ display: "Space Grotesk", body: "Inter", mono: "JetBrains Mono" }),
});
export type VisualTokens = z.infer<typeof VisualTokens>;

export const DEFAULT_TOKENS: VisualTokens = VisualTokens.parse({});
