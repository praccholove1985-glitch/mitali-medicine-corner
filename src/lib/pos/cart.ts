/**
 * The cart is only a list of what the cashier wants: which medicine, how many, an
 * optional discount and an optional chosen batch. It holds no prices and does no
 * money arithmetic; the server prices it (quote_sale) and sells it (complete_sale).
 */

export type DiscountType = "NONE" | "AMOUNT" | "PERCENT";

export type CartLine = {
  /** Stable id for React and for matching server errors back to a line. */
  key: string;
  medicineId: string;
  /** Known when added from search; absent for lines restored from a saved cart. */
  name?: string;
  strength?: string | null;
  unit?: string;
  prescriptionRequired?: boolean;
  quantity: number;
  discountType: DiscountType;
  /** Text as typed; the server parses it. */
  discountValue: string;
  /** null = sell by FEFO. */
  batchId: string | null;
  batchLabel?: string;
};

export type CartMedicine = {
  id: string;
  name: string;
  strength?: string | null;
  unit?: string;
  prescriptionRequired?: boolean;
};

export type CartAction =
  | { type: "add"; medicine: CartMedicine; key: string; quantity?: number }
  | { type: "setQuantity"; key: string; quantity: number }
  | { type: "increment"; key: string; by: number }
  | { type: "remove"; key: string }
  | { type: "setDiscount"; key: string; discountType: DiscountType; discountValue: string }
  | { type: "setBatch"; key: string; batchId: string | null; batchLabel?: string }
  | { type: "load"; lines: CartLine[] }
  | { type: "clear" };

export const MAX_LINE_QUANTITY = 100000;
export const MAX_LINES = 100;

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.trunc(quantity)));
}

export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "add": {
      // Scanning the same medicine again adds one more, unless a batch was pinned.
      const existing = lines.find((l) => l.medicineId === action.medicine.id && l.batchId === null);
      const add = clampQuantity(action.quantity ?? 1);
      if (existing) {
        return lines.map((l) =>
          l.key === existing.key ? { ...l, quantity: clampQuantity(l.quantity + add) } : l,
        );
      }
      if (lines.length >= MAX_LINES) return lines;
      return [
        ...lines,
        {
          key: action.key,
          medicineId: action.medicine.id,
          name: action.medicine.name,
          strength: action.medicine.strength ?? null,
          unit: action.medicine.unit,
          prescriptionRequired: action.medicine.prescriptionRequired,
          quantity: add,
          discountType: "NONE",
          discountValue: "",
          batchId: null,
        },
      ];
    }
    case "setQuantity":
      return lines.map((l) => (l.key === action.key ? { ...l, quantity: clampQuantity(action.quantity) } : l));
    case "increment":
      return lines.map((l) => (l.key === action.key ? { ...l, quantity: clampQuantity(l.quantity + action.by) } : l));
    case "remove":
      return lines.filter((l) => l.key !== action.key);
    case "setDiscount":
      return lines.map((l) =>
        l.key === action.key
          ? {
              ...l,
              discountType: action.discountType,
              discountValue: action.discountType === "NONE" ? "" : action.discountValue,
            }
          : l,
      );
    case "setBatch":
      return lines.map((l) =>
        l.key === action.key ? { ...l, batchId: action.batchId, batchLabel: action.batchId ? action.batchLabel : undefined } : l,
      );
    case "load":
      return action.lines.slice(0, MAX_LINES);
    case "clear":
      return [];
  }
}

/** The lines as the server expects them (quote_sale / complete_sale / drafts). */
export function toApiItems(lines: CartLine[]): Array<Record<string, unknown>> {
  return lines.map((l) => {
    const item: Record<string, unknown> = { medicine_id: l.medicineId, quantity: l.quantity };
    if (l.discountType !== "NONE" && l.discountValue.trim() !== "") {
      item.discount_type = l.discountType;
      item.discount_value = l.discountValue.trim();
    }
    if (l.batchId) item.batch_id = l.batchId;
    return item;
  });
}

/** Rebuild lines from a saved cart. Names are filled in later from the quote. */
export function linesFromDraft(
  items: Array<Record<string, unknown>>,
  makeKey: () => string,
): CartLine[] {
  const lines: CartLine[] = [];
  for (const raw of items.slice(0, MAX_LINES)) {
    if (typeof raw.medicine_id !== "string") continue;
    const type = raw.discount_type === "AMOUNT" || raw.discount_type === "PERCENT" ? raw.discount_type : "NONE";
    lines.push({
      key: makeKey(),
      medicineId: raw.medicine_id,
      quantity: clampQuantity(Number(raw.quantity)),
      discountType: type,
      discountValue: type === "NONE" || raw.discount_value === undefined ? "" : String(raw.discount_value),
      batchId: typeof raw.batch_id === "string" ? raw.batch_id : null,
    });
  }
  return lines;
}

export function totalUnits(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}
