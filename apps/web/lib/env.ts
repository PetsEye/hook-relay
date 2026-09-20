import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://hookrelay:hookrelay@localhost:5432/hookrelay"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  WEBHOOK_DEFAULT_TIMEOUT_MS: z.coerce.number().default(10_000),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(100),
  MAX_PAYLOAD_BYTES: z.coerce.number().default(262_144),
});

export const env = Env.parse(process.env);
