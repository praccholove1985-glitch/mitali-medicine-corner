import { describe, expect, it } from "vitest";
import {
  cartReducer,
  type CartMedicine,
  linesFromDraft,
  MAX_LINE_QUANTITY,
  MAX_LINES,
  toApiItems,
  totalUnits,
  type CartLine,
} from "./cart";

const napa: CartMedicine = { id: "m1", name: "Napa", strength: "500mg", unit: "pcs", prescriptionRequired: false };
const zimax: CartMedicine = { id: "m2", name: "Zimax", prescriptionRequired: true };

function add(lines: CartLine[], medicine: CartMedicine = napa, key = "k" + lines.length, quantity?: number) {
  return cartReducer(lines, { type: "add", medicine, key, quantity });
}

describe("cartReducer", () => {
  it("adds a medicine as one unit with no discount and FEFO", () => {
    const [line] = add([]);
    expect(line).toMatchObject({ medicineId: "m1", name: "Napa", quantity: 1, discountType: "NONE", discountValue: "", batchId: null });
  });

  it("scanning the same medicine again adds one more instead of a new line", () => {
    const lines = add(add([]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(2);
  });

  it("keeps a batch-pinned line separate from a FEFO line", () => {
    let lines = add([]);
    lines = cartReducer(lines, { type: "setBatch", key: lines[0]!.key, batchId: "b1", batchLabel: "B1" });
    lines = add(lines, napa, "k2");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.batchId)).toEqual(["b1", null]);
  });

  it("clamps quantities to a whole number between 1 and the maximum", () => {
    let lines = add([]);
    const key = lines[0]!.key;
    lines = cartReducer(lines, { type: "setQuantity", key, quantity: 0 });
    expect(lines[0]?.quantity).toBe(1);
    lines = cartReducer(lines, { type: "setQuantity", key, quantity: -5 });
    expect(lines[0]?.quantity).toBe(1);
    lines = cartReducer(lines, { type: "setQuantity", key, quantity: 2.9 });
    expect(lines[0]?.quantity).toBe(2);
    lines = cartReducer(lines, { type: "setQuantity", key, quantity: 10_000_000 });
    expect(lines[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    lines = cartReducer(lines, { type: "setQuantity", key, quantity: Number.NaN });
    expect(lines[0]?.quantity).toBe(1);
  });

  it("increments and decrements but never below one", () => {
    let lines = add([], napa, "a", 3);
    lines = cartReducer(lines, { type: "increment", key: "a", by: -1 });
    expect(lines[0]?.quantity).toBe(2);
    lines = cartReducer(lines, { type: "increment", key: "a", by: -10 });
    expect(lines[0]?.quantity).toBe(1);
  });

  it("removes a line and clears the cart", () => {
    let lines = add(add([], napa, "a"), zimax, "b");
    lines = cartReducer(lines, { type: "remove", key: "a" });
    expect(lines.map((l) => l.key)).toEqual(["b"]);
    expect(cartReducer(lines, { type: "clear" })).toEqual([]);
  });

  it("setting no discount clears the typed value", () => {
    let lines = add([], napa, "a");
    lines = cartReducer(lines, { type: "setDiscount", key: "a", discountType: "PERCENT", discountValue: "5" });
    expect(lines[0]).toMatchObject({ discountType: "PERCENT", discountValue: "5" });
    lines = cartReducer(lines, { type: "setDiscount", key: "a", discountType: "NONE", discountValue: "5" });
    expect(lines[0]).toMatchObject({ discountType: "NONE", discountValue: "" });
  });

  it("returning to FEFO drops the batch label", () => {
    let lines = add([], napa, "a");
    lines = cartReducer(lines, { type: "setBatch", key: "a", batchId: "b1", batchLabel: "B1" });
    lines = cartReducer(lines, { type: "setBatch", key: "a", batchId: null, batchLabel: "B1" });
    expect(lines[0]).toMatchObject({ batchId: null, batchLabel: undefined });
  });

  it("stops adding lines at the limit", () => {
    let lines: CartLine[] = [];
    for (let i = 0; i < MAX_LINES + 5; i++) lines = add(lines, { id: `m${i}`, name: `M${i}` }, `k${i}`);
    expect(lines).toHaveLength(MAX_LINES);
  });
});

describe("toApiItems", () => {
  it("sends only what the server needs and never a price", () => {
    let lines = add([], napa, "a", 3);
    lines = cartReducer(lines, { type: "setDiscount", key: "a", discountType: "AMOUNT", discountValue: " 10.50 " });
    lines = cartReducer(lines, { type: "setBatch", key: "a", batchId: "b9" });
    const [item] = toApiItems(lines);
    expect(item).toEqual({ medicine_id: "m1", quantity: 3, discount_type: "AMOUNT", discount_value: "10.50", batch_id: "b9" });
    expect(Object.keys(item!).some((k) => /price|total|cost/.test(k))).toBe(false);
  });

  it("omits an empty discount", () => {
    let lines = add([], napa, "a");
    lines = cartReducer(lines, { type: "setDiscount", key: "a", discountType: "PERCENT", discountValue: "  " });
    expect(toApiItems(lines)[0]).toEqual({ medicine_id: "m1", quantity: 1 });
  });
});

describe("linesFromDraft", () => {
  it("restores lines and skips junk", () => {
    let n = 0;
    const lines = linesFromDraft(
      [
        { medicine_id: "m1", quantity: 2, discount_type: "PERCENT", discount_value: "5", batch_id: "b1" },
        { medicine_id: 42, quantity: 1 },
        { quantity: 3 },
        { medicine_id: "m2", quantity: "7", discount_type: "BOGUS" },
        { medicine_id: "m3", quantity: -4 },
      ],
      () => `k${n++}`,
    );
    expect(lines.map((l) => [l.medicineId, l.quantity, l.discountType, l.batchId])).toEqual([
      ["m1", 2, "PERCENT", "b1"],
      ["m2", 7, "NONE", null],
      ["m3", 1, "NONE", null],
    ]);
  });
});

describe("totalUnits", () => {
  it("adds quantities", () => {
    expect(totalUnits(add(add([], napa, "a", 3), zimax, "b", 4))).toBe(7);
  });
});
