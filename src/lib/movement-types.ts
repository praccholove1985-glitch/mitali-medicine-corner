export type MovementType =
  | "PURCHASE"
  | "SALE"
  | "SALE_RETURN"
  | "PURCHASE_RETURN"
  | "ADJUSTMENT"
  | "DAMAGE"
  | "EXPIRED"
  | "TRANSFER"
  | "OPENING_STOCK"
  | "CORRECTION";

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  OPENING_STOCK: "Opening stock",
  PURCHASE: "Purchase",
  SALE: "Sale",
  SALE_RETURN: "Sale return",
  PURCHASE_RETURN: "Purchase return",
  ADJUSTMENT: "Adjustment",
  CORRECTION: "Correction",
  DAMAGE: "Damage",
  EXPIRED: "Expired",
  TRANSFER: "Transfer",
};

export const MOVEMENT_TYPES = Object.keys(MOVEMENT_LABELS) as MovementType[];

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as string[]).includes(value);
}
