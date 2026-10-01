/**
 * Turns database, Auth and network failures into stable app errors with
 * user-safe messages. Raw Postgres/Supabase text never reaches the user; a
 * short reference id ties the user's report to the server log line.
 *
 * Business error codes raised by later phases (PH001 insufficient_stock, ...)
 * are added to `SQLSTATE_MAP` as they are introduced.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type AppError = {
  code: AppErrorCode;
  /** Safe to show to the user. */
  message: string;
  /** Correlation id; present when the failure was logged. */
  reference?: string;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: AppError): ActionResult<never> {
  return { ok: false, error };
}

const MESSAGES: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find that record.",
  CONFLICT: "That conflicts with existing data. Refresh and check, then try again.",
  INVALID: "Some of the information isn't valid. Check it and try again.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  UNAVAILABLE: "We couldn't reach the server. Check your connection and try again.",
  UNKNOWN: "Something went wrong. Try again, and if it keeps happening tell the shop manager.",
};

/** SQLSTATE (and PostgREST) codes we recognise. */
const SQLSTATE_MAP: Record<string, { code: AppErrorCode; message?: string }> = {
  "42501": { code: "FORBIDDEN" },
  "PGRST301": { code: "UNAUTHENTICATED" },
  "PGRST303": { code: "UNAUTHENTICATED" },
  "PGRST116": { code: "NOT_FOUND" },
  "23505": { code: "CONFLICT", message: "That already exists." },
  "23503": {
    code: "CONFLICT",
    message: "That is linked to other records, or refers to something that no longer exists.",
  },
  "23514": { code: "INVALID" },
  "22P02": { code: "INVALID" },
  "22023": { code: "INVALID" },
  "23502": { code: "INVALID" },
  "22007": { code: "INVALID", message: "That date isn't valid." },
  P0002: { code: "NOT_FOUND" },
  PH010: { code: "CONFLICT", message: "That record is history and can't be changed." },
  PH030: { code: "INVALID", message: "The expiry date must be after today. Stock that has expired can't be added." },
  PH031: { code: "INVALID", message: "The sale price can't be higher than the MRP." },
  PH033: { code: "FORBIDDEN", message: "You don't have permission to set or change prices." },
  PH034: { code: "INVALID", message: "That subcategory doesn't belong to the chosen category." },
  PH041: { code: "CONFLICT", message: "You can't remove more than is on hand for that batch." },
  PH042: { code: "INVALID", message: "That batch hasn't expired yet, so it can't be written off as expired." },
  PH043: { code: "CONFLICT", message: "There is no expired stock left to write off in those batches." },
  PH040: {
    code: "CONFLICT",
    message: "That change would leave the stock count inconsistent, so nothing was saved.",
  },
};

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
};

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === "object" && error !== null ? (error as ErrorLike) : {};
}

function isNetworkFailure(error: unknown, like: ErrorLike): boolean {
  if (error instanceof TypeError) return true; // fetch() rejects with TypeError
  const message = typeof like.message === "string" ? like.message.toLowerCase() : "";
  const name = typeof like.name === "string" ? like.name : "";
  return (
    name === "AuthRetryableFetchError" ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("enotfound")
  );
}

function newReference(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * `context` names the operation ("session.load", "sale.complete") for the log.
 * Expected user-fixable outcomes (FORBIDDEN, INVALID, ...) are logged at info
 * level without detail; unexpected ones are logged as errors.
 */
export function mapError(error: unknown, context: string): AppError {
  const like = asErrorLike(error);
  const sqlstate = typeof like.code === "string" ? like.code : undefined;
  const status = typeof like.status === "number" ? like.status : undefined;

  let code: AppErrorCode = "UNKNOWN";
  let message: string | undefined;

  if (sqlstate && SQLSTATE_MAP[sqlstate]) {
    ({ code, message } = SQLSTATE_MAP[sqlstate]);
  } else if (status === 429 || sqlstate === "over_request_rate_limit") {
    code = "RATE_LIMITED";
  } else if (
    status === 401 ||
    sqlstate === "invalid_credentials" ||
    sqlstate === "session_not_found" ||
    sqlstate === "refresh_token_not_found" ||
    sqlstate === "bad_jwt"
  ) {
    code = "UNAUTHENTICATED";
  } else if (status === 403) {
    code = "FORBIDDEN";
  } else if (isNetworkFailure(error, like)) {
    code = "UNAVAILABLE";
  }

  const result: AppError = { code, message: message ?? MESSAGES[code] };

  if (code === "UNKNOWN" || code === "UNAVAILABLE") {
    result.reference = newReference();
    // Technical detail goes to the server log only. No row values, no PII.
    console.error(
      JSON.stringify({
        level: "error",
        context,
        reference: result.reference,
        code: sqlstate ?? null,
        status: status ?? null,
        name: typeof like.name === "string" ? like.name : null,
        message: typeof like.message === "string" ? like.message.slice(0, 300) : null,
      }),
    );
  }

  return result;
}
