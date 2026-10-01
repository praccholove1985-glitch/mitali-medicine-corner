/**
 * Money formatting. Amounts are decimal strings ("1234.50") as returned by the
 * database (numeric); they are never converted to floating point. The only
 * arithmetic here is grouping digits.
 */

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Bangladeshi digit grouping: 1,23,45,678 (last three, then pairs). */
function groupLakh(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const last3 = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

export type FormatMoneyOptions = {
  /** Digits after the decimal point. Default 2. Extra digits are rounded half up. */
  fractionDigits?: number;
  /** Prefix with the taka sign. Default true. */
  symbol?: boolean;
};

/**
 * Format a decimal string as taka. Returns null when the input is not a valid
 * decimal, so callers can show "Not reported" rather than a made-up zero.
 */
export function formatMoney(
  amount: string | null | undefined,
  { fractionDigits = 2, symbol = true }: FormatMoneyOptions = {},
): string | null {
  if (amount === null || amount === undefined) return null;
  const match = DECIMAL_PATTERN.exec(amount.trim());
  if (!match) return null;

  const negative = match[1] === "-";
  let whole = match[2] ?? "0";
  const fraction = match[3] ?? "";

  // Round half up on the decimal string itself.
  let kept = fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  const nextDigit = fraction.charAt(fractionDigits);
  if (nextDigit !== "" && nextDigit >= "5") {
    const scaled = BigInt(whole + kept) + BigInt(1);
    const digits = scaled.toString().padStart(fractionDigits + 1, "0");
    whole = digits.slice(0, digits.length - fractionDigits);
    kept = digits.slice(digits.length - fractionDigits);
  }
  whole = whole.replace(/^0+(?=\d)/, "");

  const body =
    groupLakh(whole) + (fractionDigits > 0 ? "." + kept : "");
  const isZero = /^[0,.]*$/.test(body);
  const sign = negative && !isZero ? "-" : "";
  return `${sign}${symbol ? "৳" : ""}${body}`;
}

const AMOUNT_PATTERN = /^(\d{1,10})(?:\.(\d{1,4}))?$/;

/** True for a non-negative amount with at most 4 decimals, e.g. "12", "1.125", "0.5". */
export function isValidAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value.trim());
}

/**
 * Exact value in ten-thousandths (scale 4), or null when invalid. Lets forms
 * compare amounts (sale price vs MRP) without floating point.
 */
export function amountToUnits(value: string): bigint | null {
  const match = AMOUNT_PATTERN.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(4, "0");
  return BigInt(whole + fraction);
}

const PAISA_PATTERN = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/**
 * Exact amount in paisa (hundredths of a taka) for something a person types into a
 * payment box: at most 2 decimals. null when invalid. Used only to show "remaining"
 * while splitting a payment; the database validates the real thing.
 */
export function parsePaisa(value: string): bigint | null {
  const match = PAISA_PATTERN.exec(value.trim());
  if (!match) return null;
  return BigInt((match[1] ?? "0") + (match[2] ?? "").padEnd(2, "0"));
}

/** Paisa back to a decimal string with 2 decimals: 1250n -> "12.50". Negative allowed. */
export function formatPaisa(paisa: bigint): string {
  const negative = paisa < BigInt(0);
  const digits = (negative ? -paisa : paisa).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
