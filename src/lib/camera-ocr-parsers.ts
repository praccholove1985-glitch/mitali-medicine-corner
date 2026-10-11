export type ProductLabelSuggestions = {
  name: string;
  genericName: string;
  brandName: string;
  strength: string;
  dosageForm: string;
  companyName: string;
};

const PRODUCT_NOISE = /^(?:mfg\.?\s*(?:date|dt)|manufacturing date|expiry|exp\.?\s*(?:date|dt)?|batch(?:\s*(?:no|number|#))?|lot(?:\s*(?:no|number|#))?|mrp|price|barcode|bar code|gtin|sku|made in|keep out|store below|prescription only|for external use|schedule|license|licence|composition|each (?:tablet|capsule|5\s*ml).*contains|marketed by|manufactured by|mfg\.?\s*by|manufactured & marketed by|dosage|side effects|indications|directions|warning|caution|storage|keep out of reach|reg\.?\s*no|registration no)\b/i;
const COMPANY_NOISE = /\b(?:pharmaceuticals?|laborator(?:y|ies)|healthcare|health care|limited|ltd\.?|inc\.?|corporation|corp\.?|industr(?:y|ies)|distributor|manufactured|marketed|manufacturers?)\b/i;
const INSTRUCTION_NOISE = /\b(?:take one|twice daily|once daily|three times|after meals|before meals|keep out of reach|store in a cool|protect from light|do not chew|for external use|prescription only|use as directed|not to exceed|read leaflet)\b/i;

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

function valueAfterLabel(lines: string[], labels: RegExp): string {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labels.test(line)) continue;
    const inline = line.replace(labels, "").replace(/^[:\s\-–]+/, "").trim();
    if (inline.length >= 2) return inline;
    const next = lines[index + 1]?.trim() ?? "";
    if (next.length >= 2 && !PRODUCT_NOISE.test(next) && !/^[\d.,/-]+$/.test(next)) return next;
  }
  return "";
}

function normalizeIngredient(value: string): string {
  return value
    .replace(/^\s*(?:each\s+(?:tablet|capsule|5\s*ml|ml)[^:]*contains|composition|generic\s*name|active\s*ingredient)\s*:?\s*/i, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|ml|iu|%)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))?/gi, " ")
    .replace(/\b(?:bp|usp|ip|ph\.?\s*eur\.?|each|contains|per|tablet|capsule)\b/gi, " ")
    .replace(/\s*[+;]\s*/g, " + ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
    .trim();
}

function isLikelyProductLine(line: string): boolean {
  const value = line.trim();
  if (value.length < 3 || value.length > 100) return false;
  if (!/\p{L}{2}/u.test(value)) return false;
  if (PRODUCT_NOISE.test(value) || INSTRUCTION_NOISE.test(value) || COMPANY_NOISE.test(value)) return false;
  if (/^(?:batch|lot|exp|expiry|mfg|mrp|price|barcode|generic|composition|manufacturer|manufactured|marketed|ingredients?|contains|each)\b/i.test(value)) return false;
  if (/^\d+[\s./-]*\d*$/.test(value)) return false;
  if (/^(?:tablet|tablets|capsule|capsules|syrup|suspension|drops?|cream|ointment|gel|lotion|injection|solution|powder|sachet|oral solution|oral suspension)$/i.test(value)) return false;
  if (/^(?:bp|usp|ip|mg|mcg|g|ml|iu)\b/i.test(value)) return false;
  if (/^[^a-z]{0,8}\d{4,}[^a-z]{0,8}$/i.test(value)) return false;
  return true;
}

export function suggestProductLabelDetails(raw: string): ProductLabelSuggestions {
  const lines = cleanLines(raw);
  const full = lines.join("\n");

  const companyFromLabel = valueAfterLabel(lines, /(?:manufactured\s*(?:&|and)\s*marketed\s*by|manufactured\s*by|marketed\s*by|mfg\.?\s*by|manufacturer)\b\s*:?\s*/i);
  const companyName = companyFromLabel || firstCapture(full, [
    /(?:manufactured\s*(?:&|and)\s*marketed\s*by|manufactured\s*by|marketed\s*by|mfg\.?\s*by|manufacturer\s*:?)\s*([^:\n]+(?:limited|ltd\.?|pharmaceuticals?|laborator(?:y|ies)|healthcare)[^\n]*)/i,
  ]);

  const compositionLabels = /(?:generic\s*name|active\s*ingredient|composition|each\s+(?:tablet|capsule|sachet|5\s*ml|ml)[^\n]*?contains)\b\s*:?\s*/i;
  let genericSource = valueAfterLabel(lines, compositionLabels);
  if (!genericSource) {
    genericSource = firstCapture(full, [
      /(?:generic\s*name|active\s*ingredient|composition)\s*[:\-]\s*([^\n]+)/i,
      /each\s+(?:tablet|capsule|sachet|5\s*ml|ml)[^\n]*?contains\s*[:\-]?\s*([^\n]+)/i,
    ]);
  }

  // Prefer a concentration such as 5 mg/5 ml over package size such as 100 ml.
  let strength = firstCapture(full, [
    /\b(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|iu|%)\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))\b/i,
    /\b(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|iu|%))\b/i,
  ]);
  if (!strength) {
    strength = firstCapture(full, [/\b(\d+(?:\.\d+)?\s*ml)\b/i]);
  }
  strength = strength.replace(/\s+/g, " ").trim();

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
    [/\bpowder\b/i, "Powder"],
    [/\beye\s+ointment\b/i, "Eye ointment"],
    [/\beye\s+drops?\b/i, "Eye drops"],
    [/\bnasal\s+spray\b/i, "Nasal spray"],
    [/\bspray\b/i, "Spray"],
  ];
  const dosageForm = forms.find(([pattern]) => pattern.test(full))?.[1] ?? "";

  const candidates = lines.filter(isLikelyProductLine);
  const companyClean = companyName.trim().toLowerCase();
  const genericNormalized = normalizeIngredient(genericSource);
  const brandLine = candidates.find((line) => {
    const lower = line.toLowerCase();
    if (companyClean && (lower === companyClean || lower.includes(companyClean))) return false;
    if (genericSource && lower === genericSource.toLowerCase()) return false;
    if (genericNormalized && (lower === genericNormalized.toLowerCase() || lower.startsWith(genericNormalized.toLowerCase() + " "))) return false;
    // Keep the brand/product identity line, but reject text that is mostly an ingredient list.
    if (/\b(?:each\s+(?:tablet|capsule)|contains|composition|active ingredient|generic name|manufactured|marketed by)\b/i.test(line)) return false;
    return true;
  }) ?? "";

  // A lot of medicine labels print the generic on the line immediately following "Composition"
  // without any explicit "Generic name" heading. Infer it only from a labelled composition
  // or another non-brand line that contains ingredient-standard suffixes.
  if (!genericSource) {
    const genericCandidate = lines.find((line) =>
      line !== brandLine &&
      line.length <= 130 &&
      /\b(?:bp|usp|ip)\b/i.test(line) &&
      /\p{L}{3,}/u.test(line) &&
      !COMPANY_NOISE.test(line) &&
      !INSTRUCTION_NOISE.test(line)
    );
    if (genericCandidate) genericSource = genericCandidate;
  }
  const genericName = normalizeIngredient(genericSource).slice(0, 160);

  let name = brandLine;
  if (name && strength && !name.toLowerCase().includes(strength.toLowerCase())) name = name + " " + strength;
  if (name && dosageForm && !name.toLowerCase().includes(dosageForm.toLowerCase())) name = name + " " + dosageForm;

  return {
    name: name.slice(0, 160),
    genericName,
    brandName: brandLine.slice(0, 120),
    strength: strength.slice(0, 80),
    dosageForm,
    companyName: companyName.replace(/\b(?:batch|lot|exp\.?|expiry|mrp|price)\b.*$/i, "").trim().slice(0, 160),
  };
}

/** Candidate search phrases are separate because catalogue search matches fields independently. */
export function productSearchTermsFromDetails(details: ProductLabelSuggestions, raw = ""): string[] {
  const terms: string[] = [];
  const add = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").replace(/^[\s:;,\-–]+|[\s:;,\-–]+$/g, "").trim();
    if (normalized.length < 2 || normalized.length > 100 || PRODUCT_NOISE.test(normalized) || INSTRUCTION_NOISE.test(normalized)) return;
    if (!terms.some((item) => item.toLowerCase() === normalized.toLowerCase())) terms.push(normalized);
  };
  if (details.name && details.strength && !details.name.toLowerCase().includes(details.strength.toLowerCase())) {
    add(details.name + " " + details.strength);
  }
  add(details.name);
  if (details.brandName && details.strength) add(details.brandName + " " + details.strength);
  add(details.brandName);
  if (details.genericName && details.strength) add(details.genericName + " " + details.strength);
  add(details.genericName);
  // Search other meaningful OCR lines individually; never send the whole paragraph as one query.
  for (const line of cleanLines(raw)) {
    if (isLikelyProductLine(line)) add(line);
  }
  add(details.companyName);
  return terms.slice(0, 8);
}

export function productSearchTextFromLabel(raw: string): string {
  const details = suggestProductLabelDetails(raw);
  return productSearchTermsFromDetails(details, raw)[0] ?? "";
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
