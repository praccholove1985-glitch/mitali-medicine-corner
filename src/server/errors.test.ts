import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapError } from "./errors";

describe("mapError", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("maps permission failures without logging", () => {
    const result = mapError({ code: "42501", message: 'permission denied for table "audit_log"' }, "t");
    expect(result.code).toBe("FORBIDDEN");
    expect(result.message).not.toMatch(/audit_log|table/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never leaks raw database text", () => {
    const raw = 'duplicate key value violates unique constraint "customers_phone_key"';
    const result = mapError({ code: "23505", message: raw, details: "Key (phone)=(01711111111) already exists." }, "t");
    expect(result.code).toBe("CONFLICT");
    expect(result.message).not.toContain("customers_phone_key");
    expect(result.message).not.toContain("01711111111");
  });

  it("maps append-only violations", () => {
    expect(mapError({ code: "PH010", message: "audit_log is append-only" }, "t").code).toBe("CONFLICT");
  });

  it("maps invalid input and missing rows", () => {
    expect(mapError({ code: "23514" }, "t").code).toBe("INVALID");
    expect(mapError({ code: "22P02" }, "t").code).toBe("INVALID");
    expect(mapError({ code: "PGRST116" }, "t").code).toBe("NOT_FOUND");
  });

  it("maps auth failures", () => {
    expect(mapError({ code: "invalid_credentials", status: 400 }, "t").code).toBe("UNAUTHENTICATED");
    expect(mapError({ code: "PGRST301" }, "t").code).toBe("UNAUTHENTICATED");
    expect(mapError({ status: 401 }, "t").code).toBe("UNAUTHENTICATED");
  });

  it("maps rate limiting", () => {
    expect(mapError({ status: 429 }, "t").code).toBe("RATE_LIMITED");
    expect(mapError({ code: "over_request_rate_limit" }, "t").code).toBe("RATE_LIMITED");
  });

  it("maps network failures, with a reference and a log line", () => {
    const result = mapError(new TypeError("fetch failed"), "session.load");
    expect(result.code).toBe("UNAVAILABLE");
    expect(result.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(logged.context).toBe("session.load");
    expect(logged.reference).toBe(result.reference);
  });

  it("falls back to UNKNOWN with a generic message", () => {
    const result = mapError({ code: "XX000", message: "internal error: secret detail" }, "t");
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).not.toContain("secret detail");
    expect(result.reference).toBeDefined();
  });

  it("copes with non-object errors", () => {
    expect(mapError("boom", "t").code).toBe("UNKNOWN");
    expect(mapError(null, "t").code).toBe("UNKNOWN");
    expect(mapError(undefined, "t").code).toBe("UNKNOWN");
  });

  it("gives specific, safe messages for pharmacy rules", () => {
    expect(mapError({ code: "PH030", message: "expiry date must be after today" }, "t")).toMatchObject({
      code: "INVALID",
      message: expect.stringMatching(/expiry date must be after today/i),
    });
    expect(mapError({ code: "PH031" }, "t").message).toMatch(/MRP/);
    expect(mapError({ code: "PH033" }, "t")).toMatchObject({ code: "FORBIDDEN" });
    expect(mapError({ code: "PH034" }, "t").code).toBe("INVALID");
    expect(mapError({ code: "PH040", message: "Batch 123 holds 5" }, "t").message).not.toContain("123");
    expect(mapError({ code: "P0002", message: "medicine not found" }, "t").code).toBe("NOT_FOUND");
    expect(mapError({ code: "22007" }, "t").code).toBe("INVALID");
  });

  it("explains stock rules in plain words", () => {
    expect(mapError({ code: "PH041", message: "cannot remove 5 from a batch holding 2" }, "t").message).not.toMatch(/\b5\b|\b2\b/);
    expect(mapError({ code: "PH041" }, "t").code).toBe("CONFLICT");
    expect(mapError({ code: "PH059", message: "dup", hint: '{"purchase_no":"PUR-000009"}' }, "t")).toMatchObject({
      code: "CONFLICT",
      message: expect.not.stringContaining("PUR-000009"),
    });
    for (const code of ["PH060", "PH061", "PH062", "PH063"]) {
      expect(mapError({ code, message: "raw 123.45 detail" }, "t").message, code).not.toContain("123.45");
    }
    expect(mapError({ code: "PH058", message: "payment exceeds what is due", hint: '{"due":"12.00"}' }, "t")).toMatchObject({
      code: "INVALID",
      message: expect.not.stringContaining("12.00"),
    });
    expect(mapError({ code: "PH042" }, "t").code).toBe("INVALID");
    expect(mapError({ code: "PH043" }, "t").message).toMatch(/no expired stock/i);
  });

  it("has a plain message for every point-of-sale rule", () => {
    const expected: Record<string, string> = {
      PH001: "CONFLICT", PH044: "INVALID", PH050: "INVALID", PH051: "INVALID", PH052: "FORBIDDEN",
      PH053: "FORBIDDEN", PH054: "FORBIDDEN", PH055: "INVALID", PH056: "CONFLICT", PH057: "INVALID",
    };
    for (const [code, appCode] of Object.entries(expected)) {
      const mapped = mapError({ code, message: "raw detail 12.50 Napa", hint: '{"medicine_id":"x"}' }, "t");
      expect(mapped.code, code).toBe(appCode);
      expect(mapped.message, code).not.toMatch(/raw detail|12\.50|Napa|medicine_id/);
      expect(mapped.reference, code).toBeUndefined();
    }
  });
});
