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


describe("common Bangladeshi medicine label layouts", () => {
  it("separates Calbo 500 from Calcium 500 mg and identifies Square on a blister pack", () => {
    const raw = ["Calbo 500", "Calcium 500 mg", "SQUARE", "Mfg. Lic. No. 235 & 460"].join("\n");
    const details = suggestProductLabelDetails(raw);
    expect(details.name).toBe("Calbo 500");
    expect(details.brandName).toBe("Calbo");
    expect(details.genericName).toBe("Calcium");
    expect(details.strength).toBe("500 mg");
    expect(details.dosageForm).toBe("");
    expect(details.companyName).toBe("SQUARE");
  });

  it("separates Zimax 500 from Azithromycin 500 mg", () => {
    const raw = ["ZIMAX 500", "Azithromycin 500 mg", "18 Tablets", "SQUARE"].join("\n");
    const details = suggestProductLabelDetails(raw);
    expect(details.name).toBe("ZIMAX 500 Tablet");
    expect(details.brandName).toBe("ZIMAX");
    expect(details.genericName).toBe("Azithromycin");
    expect(details.strength).toBe("500 mg");
    expect(details.companyName).toBe("SQUARE");
  });

  it("handles liquid medicine labels and multiword dosage forms", () => {
    const raw = ["ZIMAX", "Azithromycin 200 mg/5 ml", "Powder for oral suspension", "SQUARE"].join("\n");
    const details = suggestProductLabelDetails(raw);
    expect(details.name).toBe("ZIMAX 200 mg/5 ml Powder for oral suspension");
    expect(details.brandName).toBe("ZIMAX");
    expect(details.genericName).toBe("Azithromycin");
    expect(details.strength).toBe("200 mg/5 ml");
    expect(details.dosageForm).toBe("Powder for oral suspension");
    expect(details.companyName).toBe("SQUARE");
  });

  it("recognizes specific drops and cream forms before generic forms", () => {
    expect(suggestProductLabelDetails(["Tear Plus", "Lubricant", "Eye drops", "Renata"].join("\n")).dosageForm).toBe("Eye drops");
    expect(suggestProductLabelDetails(["SkinCare", "Clotrimazole 1%", "Cream", "ACI"].join("\n")).dosageForm).toBe("Cream");
  });
});


describe("low-confidence brand OCR and standalone manufacturer marks", () => {
  it("does not promote a short mixed-case OCR fragment to the brand name", () => {
    const raw = ["oT TL", "Azithromycin 500 mg", "Tablet", "A SQUARE"].join("\n");
    const details = suggestProductLabelDetails(raw);

    expect(details.brandName).toBe("");
    expect(details.name).toBe("");
    expect(details.genericName).toBe("Azithromycin");
    expect(details.strength).toBe("500 mg");
    expect(details.dosageForm).toBe("Tablet");
    expect(details.companyName).toBe("SQUARE");
  });

  it("normalizes a one-letter OCR artifact before a known manufacturer mark", () => {
    const details = suggestProductLabelDetails(["ZIMAX 500", "Azithromycin 500 mg", "A SQUARE"].join("\n"));

    expect(details.brandName).toBe("ZIMAX");
    expect(details.name).toBe("ZIMAX 500");
    expect(details.companyName).toBe("SQUARE");
  });
});
