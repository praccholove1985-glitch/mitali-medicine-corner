import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signedDelta } from "./inventory-payload";
import { adjustStockSchema, writeOffSchema } from "./validation/inventory";
import { MOVEMENT_LABELS, isMovementType } from "./movement-types";

describe("signedDelta", () => {
  it("follows the direction for adjustments and corrections", () => {
    expect(signedDelta("ADJUSTMENT", "add", 5)).toBe(5);
    expect(signedDelta("ADJUSTMENT", "remove", 5)).toBe(-5);
    expect(signedDelta("CORRECTION", "add", 2)).toBe(2);
    expect(signedDelta("CORRECTION", "remove", 2)).toBe(-2);
  });

  it("always removes for damage and expiry, whatever the direction says", () => {
    expect(signedDelta("DAMAGE", "add", 3)).toBe(-3);
    expect(signedDelta("EXPIRED", "add", 3)).toBe(-3);
    expect(signedDelta("DAMAGE", "remove", 3)).toBe(-3);
  });

  it("rejects zero, negatives and fractions", () => {
    expect(() => signedDelta("ADJUSTMENT", "add", 0)).toThrow(RangeError);
    expect(() => signedDelta("ADJUSTMENT", "add", -1)).toThrow(RangeError);
    expect(() => signedDelta("ADJUSTMENT", "add", 1.5)).toThrow(RangeError);
  });
});

const id = "11111111-1111-1111-1111-111111111111";
const base = { batch_id: id, medicine_id: id, client_request_id: id, movement_type: "ADJUSTMENT", direction: "remove", quantity: "3", reason: "Count was short" };

describe("adjustStockSchema", () => {
  it("accepts a complete adjustment", () => {
    expect(adjustStockSchema.parse(base)).toMatchObject({ quantity: "3", reason: "Count was short" });
  });
  it("requires a reason", () => {
    const result = adjustStockSchema.safeParse({ ...base, reason: "   " });
    expect(result.success).toBe(false);
  });
  it("requires a positive whole quantity", () => {
    for (const quantity of ["0", "-2", "1.5", "abc", ""]) {
      expect(adjustStockSchema.safeParse({ ...base, quantity }).success, quantity).toBe(false);
    }
  });
  it("only allows manual movement types", () => {
    expect(adjustStockSchema.safeParse({ ...base, movement_type: "SALE" }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, movement_type: "PURCHASE" }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, movement_type: "DAMAGE" }).success).toBe(true);
  });
});

describe("writeOffSchema", () => {
  it("needs at least one batch and caps the list", () => {
    expect(writeOffSchema.safeParse({ batch_ids: [] }).success).toBe(false);
    expect(writeOffSchema.safeParse({ batch_ids: [id] }).success).toBe(true);
    expect(writeOffSchema.safeParse({ batch_ids: Array(101).fill(id) }).success).toBe(false);
  });
  it("treats a blank reason as none", () => {
    expect(writeOffSchema.parse({ batch_ids: [id], reason: "  " }).reason).toBeUndefined();
  });
});

describe("movement types", () => {
  it("labels every type the database allows", () => {
    expect(Object.keys(MOVEMENT_LABELS).sort()).toEqual(
      ["ADJUSTMENT", "CORRECTION", "DAMAGE", "EXPIRED", "OPENING_STOCK", "PURCHASE", "PURCHASE_RETURN", "SALE", "SALE_RETURN", "TRANSFER"],
    );
    expect(isMovementType("DAMAGE")).toBe(true);
    expect(isMovementType("MAGIC")).toBe(false);
  });

  it("matches the movement types the database accepts", () => {
    const sql = readFileSync("supabase/migrations/20261001000005_catalogue_and_batches.sql", "utf8");
    const block = /movement_type\s+text not null check \(movement_type in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const dbTypes = [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(dbTypes.length).toBe(10);
    expect(Object.keys(MOVEMENT_LABELS).sort()).toEqual(dbTypes);
  });
});
