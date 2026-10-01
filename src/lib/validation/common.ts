import { z } from "zod";

/** Any 8-4-4-4-12 hex id. Zod's own uuid() rejects some ids Postgres will accept. */
export const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id.");
