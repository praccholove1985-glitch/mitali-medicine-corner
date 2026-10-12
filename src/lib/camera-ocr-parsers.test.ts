import { describe, expect, it } from "vitest";
import { productNameCandidatesFromLabel, suggestProductLabelDetails } from "./camera-ocr-parsers";

describe("medicine label OCR parsing", () => {
  it("prefers a product name over generic, strength and manufacturer lines", () => {
    const raw = [
      "NAPA EXTRA",
      "Paracetamol BP",
      "500 mg",
      "Tablet",
      "Manufactured by Beximco Pharmaceuticals Ltd.",
    ].join("\n");

    const details = suggestProductLabelDetails(raw);

    expect(details.brandName).toBe("NAPA EXTRA");
    expect(details.name).toBe("NAPA EXTRA 500 mg Tablet");
    expect(details.genericName).toBe("Paracetamol");
    expect(details.strength).toBe("500 mg");
    expect(details.dosageForm).toBe("Tablet");
    expect(productNameCandidatesFromLabel(raw)[0]).toBe("NAPA EXTRA");
  });

  it("does not invent a product name from strength and dosage-form lines alone", () => {
    const raw = ["500 mg", "Tablet", "Batch No: 12345", "MRP 12.00"].join("\n");

    const details = suggestProductLabelDetails(raw);

    expect(details.name).toBe("");
    expect(details.brandName).toBe("");
    expect(productNameCandidatesFromLabel(raw)).toEqual([]);
  });

  it("does not return the manufacturer as a product-name candidate", () => {
    const raw = [
      "Cetirizine",
      "10 mg",
      "Manufactured by Square Pharmaceuticals Ltd.",
    ].join("\n");

    const candidates = productNameCandidatesFromLabel(raw);

    expect(candidates).not.toContain("Manufactured by Square Pharmaceuticals Ltd.");
    expect(candidates[0]).toBe("Cetirizine");
  });
});
