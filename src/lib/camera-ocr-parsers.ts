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
const KNOWN_PHARMA_COMPANY = /\b(?:square|incepta|beximco|renata|opsonin|eskayef|aci|acme|aristopharma|drug international|ibn sina|orion|beacon|popular|radiant|navana|ziska|general pharmaceuticals|unimed|jayson|globe|biopharma|delta pharma|pharmasia|chemico|pfizer|gsk|glaxosmithkline|novartis|sanofi|roche|abbott|bayer|eli lilly|johnson\s*&\s*johnson|merck|sun pharma|cipla|dr\.?\s*reddy)\b/i;
const UNIT_STRENGTH = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|ml|iu|%)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|iu))?/i;

function isLikelyCompanyLine(line: string): boolean {
  return COMPANY_NOISE.test(line) || KNOWN_PHARMA_COMPANY.test(line);
}

function hasIngredientText(line: string): boolean {
  const remaining = line
    .replace(UNIT_STRENGTH, " ")
    .replace(/\b(?:tablets?|tabs?\.?|capsules?|caps?\.?|dry syrup|syrup|suspension|drops?|eye drops?|ear drops?|oral drops?|cream|ointment|gel|lotion|injection|inhaler|sachet|suppository|solution|powder|spray|mouthwash|lozenge|granules?|bp|usp|ip|each|contains|composition|active ingredient|generic name)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\p{L}{3,}/u.test(remaining);
}

function cleanLines(raw: string): string[] {
  // Some phone/OCR combinations return label sections as one long line.
  // Split before recognizable section headings so each field can be extracted.
  const expanded = raw
    .replace(/\s+(?=(?:generic(?:\s+name)?|active\s+ingredient|composition|each\s+(?:tablet|capsule|sachet|5\s*ml|ml)[^\n]*?contains)\b)/gi, "\n")
    .replace(/\s+(?=(?:manufactured\s*(?:&|and)\s*marketed\s*by|manufactured\s*by|marketed\s*by|mfg\.?\s*by|manufacturer)\b)/gi, "\n")
    .replace(/\s+(?=(?:batch\s*(?:no|number|#)|lot\s*(?:no|number|#)|expiry\s*date|exp\.?\s*date|mfg\.?\s*date|mrp|barcode)\b)/gi, "\n");
  return expanded
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
  if (PRODUCT_NOISE.test(value) || INSTRUCTION_NOISE.test(value) || isLikelyCompanyLine(value)) return false;
  if (/^(?:batch|lot|exp|expiry|mfg|mrp|price|barcode|generic|composition|manufacturer|manufactured|marketed|ingredients?|contains|each)\b/i.test(value)) return false;
  if (/^\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|ml|iu|%)\s*(?:\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))?$/i.test(value)) return false;
  if (/^\d+\s*(?:tablets?|capsules?|strips?|bottles?|sachets?|vials?|ampoules?)$/i.test(value)) return false;
  if (/^(?:take|once|twice|thrice|before|after|use|store|keep|avoid|do not)\b/i.test(value)) return false;
  if (/^\d+[\s./-]*\d*$/.test(value)) return false;
  if (/^(?:tablet|tablets|capsule|capsules|syrup|suspension|drops?|cream|ointment|gel|lotion|injection|solution|powder|sachet|oral solution|oral suspension)$/i.test(value)) return false;
  if (/^(?:bp|usp|ip|mg|mcg|g|ml|iu)\b/i.test(value)) return false;
  if (/^[^a-z]{0,8}\d{4,}[^a-z]{0,8}$/i.test(value)) return false;
  return true;
}

function rankProductNameCandidates(
  lines: string[],
  context: { companyName: string; genericName: string; strength: string },
): string[] {
  const company = context.companyName.trim().toLocaleLowerCase();
  const generic = context.genericName.trim().toLocaleLowerCase();
  const strengthKey = context.strength.toLocaleLowerCase().replace(/\s+/g, "");

  return lines
    .map((line) => {
      const lower = line.toLocaleLowerCase();
      if (company && (lower === company || lower.includes(company))) return { line, score: -100 };
      if (isLikelyCompanyLine(line)) return { line, score: -100 };
      if (generic && (lower === generic || lower.startsWith(generic + " "))) return { line, score: -100 };
      if (/\b(?:each\s+(?:tablet|capsule)|contains|composition|active ingredient|generic name|manufactured|marketed by)\b/i.test(line)) {
        return { line, score: -100 };
      }

      // A line that contains only a strength or dosage form is not a product name.
      const identity = line
        .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|ml|iu|%)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))?/gi, " ")
        .replace(/\b(?:tablets?|tabs?\.?|capsules?|caps?\.?|dry syrup|syrup|oral suspension|suspension|eye drops?|ear drops?|oral drops?|drops?|cream|ointment|gel|lotion|injection|inhaler|sachet|suppository|oral solution|solution|powder|nasal spray|spray|mouthwash|lozenge|granules?|bp|usp|ip)\b/gi, " ")
        .replace(/[^\p{L}\s'-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      const letters = identity.replace(/[^\p{L}]/gu, "");
      if (letters.length < 3) return { line, score: -100 };

      const wordCount = identity.split(/\s+/).filter(Boolean).length;
      const originalLetters = line.match(/\p{L}/gu) ?? [];
      const uppercaseLetters = line.match(/\p{Lu}/gu) ?? [];
      const uppercaseRatio = uppercaseLetters.length / Math.max(1, originalLetters.length);

      let score = 0;
      score += identity.length >= 4 && identity.length <= 28 ? 4 : identity.length <= 40 ? 2 : -2;
      score += wordCount >= 1 && wordCount <= 3 ? 3 : wordCount <= 5 ? 1 : -3;
      if (uppercaseRatio >= 0.65) score += 1;
      if (line.length > 48) score -= 3;
      if (UNIT_STRENGTH.test(line)) score -= 3;
      if (/\b(?:batch|expiry|expiration|mrp|price|barcode|manufactured|marketed|pharmaceuticals?|laborator(?:y|ies)|limited|ltd\.?)\b/i.test(line)) score -= 5;
      if (strengthKey && lower.replace(/\s+/g, "").includes(strengthKey)) score += 1;
      return { line, score };
    })
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score || a.line.length - b.line.length)
    .map((item) => item.line)
    .filter((line, index, all) => all.findIndex((item) => item.toLocaleLowerCase() === line.toLocaleLowerCase()) === index)
    .slice(0, 6);
}

/** High-ranked label text candidates help users correct a noisy OCR guess quickly. */
export function productNameCandidatesFromLabel(raw: string): string[] {
  const lines = cleanLines(raw).filter(isLikelyProductLine);
  const details = suggestProductLabelDetails(raw);
  return rankProductNameCandidates(lines, {
    companyName: details.companyName,
    genericName: details.genericName,
    strength: details.strength,
  });
}

/** Strip a strength number from the brand mark when it duplicates the separate strength field. */
export function productBrandNameFromLine(productLine: string, strength: string): string {
  let brand = productLine.trim().replace(/[®™©]+$/g, "").trim();
  const amount = strength.match(/\d+(?:\.\d+)?/)?.[0];
  if (amount) brand = brand.replace(new RegExp("\\s+" + amount.replace(/[.]/g, "\\.") + "\\s*$", "i"), "").trim();
  brand = brand.replace(/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|kg|ml|iu|%)\s*$/i, "").trim();
  return brand;
}

/** Keep the printed product title, avoid duplicating its number, and append form when useful. */
export function productDisplayNameFromLine(productLine: string, strength: string, dosageForm: string): string {
  let name = productLine.trim().replace(/[®™©]+$/g, "").trim();
  const amount = strength.match(/\d+(?:\.\d+)?/)?.[0];
  const titleHasStrengthNumber = Boolean(amount && new RegExp("(?:^|\\D)" + amount.replace(/[.]/g, "\\.") + "(?:\\D|$)").test(name));
  const titleHasUnitStrength = Boolean(strength && name.replace(/\s+/g, "").toLocaleLowerCase().includes(strength.replace(/\s+/g, "").toLocaleLowerCase()));
  if (strength && !titleHasStrengthNumber && !titleHasUnitStrength) name = [name, strength].filter(Boolean).join(" ");
  if (dosageForm && !name.toLocaleLowerCase().includes(dosageForm.toLocaleLowerCase())) {
    name = [name, dosageForm].filter(Boolean).join(" ");
  }
  return name.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function suggestProductLabelDetails(raw: string): ProductLabelSuggestions {
  const lines = cleanLines(raw);
  const full = lines.join("\n");

  const companyFromLabel = valueAfterLabel(lines, /(?:manufactured\s*(?:&|and)\s*marketed\s*by|manufactured\s*by|marketed\s*by|mfg\.?\s*by|manufacturer)\b\s*:?\s*/i);
  const companyName = companyFromLabel || firstCapture(full, [
    /(?:manufactured\s*(?:&|and)\s*marketed\s*by|manufactured\s*by|marketed\s*by|mfg\.?\s*by|manufacturer\s*:?)\s*([^:\n]+(?:limited|ltd\.?|pharmaceuticals?|laborator(?:y|ies)|healthcare)[^\n]*)/i,
  ]) || lines.find((line) => isLikelyCompanyLine(line)) || "";

  const compositionLabels = /(?:generic\s*name|active\s*ingredient|composition|each\s+(?:tablet|capsule|sachet|5\s*ml|ml)[^\n]*?contains)\b\s*:?\s*/i;
  let genericSource = valueAfterLabel(lines, compositionLabels);
  if (!genericSource) {
    genericSource = firstCapture(full, [
      /(?:generic\s*name|generic|active\s*ingredient|composition)\s*[:\-]\s*([^\n]+)/i,
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
    [/\bpowder\s+for\s+oral\s+suspension\b/i, "Powder for oral suspension"],
    [/\bdry\s+syrup\b/i, "Dry syrup"],
    [/\boral\s+suspension\b/i, "Oral suspension"],
    [/\beye\s+ointment\b/i, "Eye ointment"],
    [/\beye\s+drops?\b/i, "Eye drops"],
    [/\bear\s+drops?\b/i, "Ear drops"],
    [/\boral\s+drops?\b/i, "Oral drops"],
    [/\bnasal\s+spray\b/i, "Nasal spray"],
    [/\beffervescent\s+tablets?\b/i, "Effervescent tablet"],
    [/\bchewable\s+tablets?\b/i, "Chewable tablet"],
    [/\bdispersible\s+tablets?\b/i, "Dispersible tablet"],
    [/\bmodified\s+release\s+tablets?\b/i, "Modified-release tablet"],
    [/\btablet(?:s)?\b|\btab\.?\b/i, "Tablet"],
    [/\bcapsule(?:s)?\b|\bcap\.?\b/i, "Capsule"],
    [/\bsyrup\b/i, "Syrup"],
    [/\bsuspension\b/i, "Suspension"],
    [/\binjection\b|\binj\.?\b|\bampoule\b|\bvial\b/i, "Injection"],
    [/\bcream\b/i, "Cream"],
    [/\bointment\b|\boint\.?\b/i, "Ointment"],
    [/\binhaler\b/i, "Inhaler"],
    [/\bsachet\b/i, "Sachet"],
    [/\bsuppository\b/i, "Suppository"],
    [/\boral\s+solution\b/i, "Oral solution"],
    [/\bsolution\b/i, "Solution"],
    [/\bgel\b/i, "Gel"],
    [/\blotion\b/i, "Lotion"],
    [/\bpowder\b/i, "Powder"],
    [/\bdrops?\b/i, "Drops"],
    [/\bmouthwash\b/i, "Mouthwash"],
    [/\blozenge\b/i, "Lozenge"],
    [/\bgranules?\b/i, "Granules"],
    [/\bspray\b/i, "Spray"],
    [/\bpatch\b/i, "Patch"],
    [/\bpessary\b/i, "Pessary"],
  ];
  const dosageForm = forms.find(([pattern]) => pattern.test(full))?.[1] ?? "";

  const candidates = lines.filter(isLikelyProductLine);
  const genericNormalized = normalizeIngredient(genericSource);
  const brandLine = rankProductNameCandidates(candidates, {
    companyName,
    genericName: genericNormalized,
    strength,
  })[0] ?? "";

  // Ingredient text is often printed without a "Generic name" heading.
  // Prefer a line marked with BP/USP/IP, then a non-brand line with concentration
  // such as "Calcium 500 mg" or "Azithromycin 200 mg/5 ml".
  if (!genericSource) {
    const isGenericCandidate = (line: string) =>
      line !== brandLine &&
      line.length <= 130 &&
      hasIngredientText(line) &&
      !isLikelyCompanyLine(line) &&
      !PRODUCT_NOISE.test(line) &&
      !INSTRUCTION_NOISE.test(line) &&
      !/\b(?:manufactured|marketed|batch|expiry|mrp|price|barcode)\b/i.test(line);
    const standardized = lines.find((line) => isGenericCandidate(line) && /\b(?:bp|usp|ip)\b/i.test(line));
    const withConcentration = lines.find((line) => isGenericCandidate(line) && UNIT_STRENGTH.test(line));
    genericSource = standardized || withConcentration || "";
  }
  const genericName = normalizeIngredient(genericSource).slice(0, 160);

  const name = brandLine
    ? productDisplayNameFromLine(brandLine, strength, dosageForm)
    : "";

  return {
    name: name.slice(0, 160),
    genericName,
    brandName: productBrandNameFromLine(brandLine, strength).slice(0, 120),
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
