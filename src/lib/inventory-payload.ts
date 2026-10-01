export const MANUAL_MOVEMENT_TYPES = ["ADJUSTMENT", "CORRECTION", "DAMAGE", "EXPIRED"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export type Direction = "add" | "remove";

/**
 * The signed change sent to adjust_stock. Damage and expiry can only remove stock;
 * adjustments and corrections follow the chosen direction. The quantity is always a
 * positive whole number here; the sign comes from the type and direction.
 */
export function signedDelta(type: ManualMovementType, direction: Direction, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("quantity must be a positive whole number");
  }
  const removes = type === "DAMAGE" || type === "EXPIRED" || direction === "remove";
  return removes ? -quantity : quantity;
}
