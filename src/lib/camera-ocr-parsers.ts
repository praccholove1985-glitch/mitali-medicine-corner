export type ProductLabelSuggestions = {
  name: string;
  genericName: string;
  brandName: string;
  strength: string;
  dosageForm: string;
  companyName: string;
};

const PRODUCT_NOISE = /^(?:mfg\.?\s*(?:date|dt)|manufacturing date|expiry|exp\.?\s*(?:date|dt)?|batch(?:\s*(?:no|number|#))?|lot(?:\s*(?:no|number|#))?|mrp|price|barcode|bar code|gtin|sku|made in|keep out|store below|prescription only|for external use|schedule|license|licence|composition|each (?:tablet|capsule|5\s*ml).*contains|marketed by|manufactured by|mfg\.?\s*by|manufactured & marketed by)\b/i;

function cleanLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/[|_]/g, " ").replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)/%+-]+$/gu, "").trim())
    .filter((line) => line.length >= 2);
}

function firstCapture(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim().replace(/^[:\-–\s]+|[|]+$/g, "").trim();
    if (value && value.length >= 2) return value;
  }
  return "";
}

export function suggestProductLabelDetails(raw: string): ProductLabelSuggestions {
  const lines = cleanLines(raw);
  const full = lines.join("\n");
  const genericLine = firstCapture(full, [
    /(?:generic\s*name|active\s*ingredient\s*:?|composition\s*:?|each\s+(?:tablet|capsule|sachet|5\s*ml|ml)[^\n]*?contains)\s*[:\-]?\s*([^\n]+)/i,
  ]);
  const companyName = firstCapture(full, [
    /(?:manufactured\s*(?:&|and)\s*marketed\s*by|manufactured\s*by|marketed\s*by|mfg\.?\s*by|manufacturer\s*:?)[\s:,-]*([^\n]+)/i,
  ]);
  const strength = firstCapture(full, [
    /\b(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|ml|iu|%)\s*(?:\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))?)\b/i,
  ]).replace(/\s+/g, " ").trim();
  const forms: Array<[RegExp, string]> = [
    [/\btablet(?:s)?\b|\btab\.?\b/i, "Tablet"],
    [/\bcapsule(?:s)?\b|\bcap\.?\b/i, "Capsule"],
    [/\bsyrup\b/i, "Syrup"],
    [/\bsuspension\b/i, "Suspension"],
    [/\bdrops?\b/i, "Drops"],
    [/\binjection\b|\binj\.?\b/i, "Injection"],
    [/\bcream\b/i, "Cream"],
    [/\bointment\b|\boint\.?\b/i, "Ointment"],
    [/\binhaler\b/i, "Inhaler"],
    [/\bsachet\b/i, "Sachet"],
    [/\bsuppository\b/i, "Suppository"],
    [/\bsolution\b/i, "Solution"],
    [/\bgel\b/i, "Gel"],
    [/\blotion\b/i, "Lotion"],
  ];
  const dosageForm = forms.find(([pattern]) => pattern.test(full))?.[1] ?? "";
  const brandLine = lines.find((line) =>
    /\p{L}/u.test(line) &&
    !PRODUCT_NOISE.test(line) &&
    !/^(?:batch|lot|exp|expiry|mfg|mrp|price|barcode|generic|composition|manufacturer|manufactured|marketed)\b/i.test(line) &&
    !/^\d+[\s./-]*\d*$/.test(line) &&
    line.length <= 90
  ) ?? "";
  let name = brandLine;
  if (name && strength && !name.toLowerCase().includes(strength.toLowerCase())) name = `${name} ${strength}`;
  if (name && dosageForm && !name.toLowerCase().includes(dosageForm.toLowerCase())) name = `${name} ${dosageForm}`;

  const generic = genericLine
    .replace(/\b(?:bp|usp|ip|ph\.\s*eur\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    name: name.slice(0, 160),
    genericName: generic.slice(0, 160),
    brandName: (brandLine || "").slice(0, 120),
    strength: strength.slice(0, 80),
    dosageForm,
    companyName: companyName.replace(/\b(?:batch|lot|exp\.?|expiry|mrp|price)\b.*$/i, "").trim().slice(0, 160),
  };
}

export function productSearchTextFromLabel(raw: string): string {
  const details = suggestProductLabelDetails(raw);
  const identity = details.brandName || details.name;
  if (identity) {
    const parts = [identity.trim()];
    if (details.strength && !identity.toLowerCase().includes(details.strength.toLowerCase())) parts.push(details.strength);
    if (details.dosageForm && !identity.toLowerCase().includes(details.dosageForm.toLowerCase())) parts.push(details.dosageForm);
    return parts.filter(Boolean).join(" ").slice(0, 100);
  }
  return cleanLines(raw).find((line) => /\p{L}/u.test(line) && !PRODUCT_NOISE.test(line) && line.length <= 100)?.slice(0, 100) ?? "";
}

export type InvoiceLineSuggestion = {
  description: string;
  quantity: string;
  unitCost: string;
};

export type InvoiceTextSuggestions = {
  invoiceNumber: string;
  invoiceDate: string;
  lines: InvoiceLineSuggestion[];
};

function toMoneyInput(value: string): string {
  return value.replace(/,/g, "").trim();
}

function toISODate(value: string): string {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    const date = new Date(`${candidate}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate ? "" : candidate;
  }
  const local = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!local) return "";
  let day = Number(local[1]);
  let month = Number(local[2]);
  let year = Number(local[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  // Invoice date conventions vary. Accept only a single unambiguous interpretation.
  if (day <= 12 && month <= 12 && day !== month) return "";
  if (month > 12 && day <= 12) [day, month] = [month, day];
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate ? "" : candidate;
}

export function suggestInvoiceDetails(raw: string): InvoiceTextSuggestions {
  const lines = cleanLines(raw);
  const full = lines.join("\n");
  const invoiceNumber = firstCapture(full, [
    /(?:invoice\s*(?:no\.?|number|#)|inv\.?\s*(?:no\.?|number|#)|bill\s*(?:no\.?|number|#)|challan\s*(?:no\.?|number|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{1,})/i,
  ]).slice(0, 64);
  const dateValue = firstCapture(full, [
    /(?:invoice\s*date|bill\s*date|date)\s*[:#-]?\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i,
  ]);
  const invoiceDate = toISODate(dateValue);
  const ignored = /\b(?:invoice|bill\s*(?:no|date|to)|challan|supplier|vendor|address|phone|mobile|email|date|time|subtotal|sub\s*total|grand\s*total|total\s*(?:amount|qty|quantity|due|discount|vat|tax)?|discount|vat|tax|paid|balance|due|net\s*amount|cash|payment|terms|thank\s*you|item\s*description|description|qty|quantity|rate|unit\s*price|amount|page\s*\d+)\b/i;
  const moneyToken = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
  const linesFound: InvoiceLineSuggestion[] = [];
  const seen = new Set<string>();

  for (const original of lines) {
    if (!/[A-Za-z]{2}/.test(original) || ignored.test(original)) continue;
    if (original.length < 4 || original.length > 160) continue;

    let description = original;
    let quantity = "";
    let unitCost = "";
    const threeValues = original.match(new RegExp(`^(.+?\\D)\\s+(${moneyToken})\\s+(${moneyToken})\\s+(${moneyToken})\\s*$`, "i"));
    const withUnit = original.match(new RegExp(`^(.+?\\D)\\s+(${moneyToken})\\s+(?:pcs?|tabs?|tablets?|capsules?|strips?|boxes?|bottles?|packs?)\\s+(${moneyToken})\\s+(${moneyToken})\\s*$`, "i"));
    const match = withUnit ?? threeValues;
    if (match) {
      description = match[1].trim();
      quantity = toMoneyInput(match[2]);
      unitCost = toMoneyInput(match[3]);
      if (Number(quantity) <= 0 || Number(quantity) > 100000) quantity = "";
      if (Number(unitCost) < 0 || Number(unitCost) > 1000000) unitCost = "";
    } else {
      // Preserve the full line as a search cue when the invoice's columns could not be read reliably.
      description = original.replace(/^\s*\d{1,3}[.)]?\s+/, "").trim();
    }

    if (description.length < 3 || !/[A-Za-z]{2}/.test(description)) continue;
    if (/(?:subtotal|grand total|net amount|total due|vat amount)/i.test(description)) continue;
    const key = description.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    linesFound.push({ description: description.slice(0, 120), quantity, unitCost });
    if (linesFound.length >= 30) break;
  }

  return { invoiceNumber, invoiceDate, lines: linesFound };
}
