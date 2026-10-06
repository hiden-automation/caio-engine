import type { Platform } from "@jarvis/core";
import { InstagramPublisher } from "./instagram.ts";
import { LinkedInPublisher } from "./linkedin.ts";
import { ThreadsPublisher } from "./threads.ts";
import type { Publisher } from "./types.ts";
import { XPublisher } from "./x.ts";

export * from "./types.ts";
export * from "./instagram.ts";
export * from "./threads.ts";
export * from "./linkedin.ts";
export * from "./x.ts";

/** Monta os publicadores das plataformas que têm credenciais nos Secrets. */
export function publishersFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<Platform, Publisher>> {
  const out: Partial<Record<Platform, Publisher>> = {};
  if (env.IG_USER_ID && env.IG_TOKEN) out.instagram = new InstagramPublisher(env.IG_USER_ID, env.IG_TOKEN);
  if (env.THREADS_USER_ID && env.THREADS_TOKEN) out.threads = new ThreadsPublisher(env.THREADS_USER_ID, env.THREADS_TOKEN);
  if (env.LINKEDIN_PERSON_URN && env.LINKEDIN_TOKEN) out.linkedin = new LinkedInPublisher(env.LINKEDIN_PERSON_URN, env.LINKEDIN_TOKEN);
  if (env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET) {
    out.x = new XPublisher({
      apiKey: env.X_API_KEY,
      apiSecret: env.X_API_SECRET,
      accessToken: env.X_ACCESS_TOKEN,
      accessSecret: env.X_ACCESS_SECRET,
    });
  }
  return out;
}
