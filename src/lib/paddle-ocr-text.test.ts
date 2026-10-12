import { describe, expect, it } from "vitest";
import { textFromPaddleResult } from "./paddle-ocr-text";

describe("PaddleOCR result text extraction", () => {
  it("preserves recognized label lines in order", () => {
    expect(textFromPaddleResult({
      items: [
        { text: "ZIMAX 500", score: 0.98 },
        { text: "Azithromycin 500 mg", score: 0.94 },
        { text: "SQUARE", score: 0.91 },
      ],
    })).toBe("ZIMAX 500\nAzithromycin 500 mg\nSQUARE");
  });

  it("ignores blank, missing and non-text result items", () => {
    expect(textFromPaddleResult({
      items: [{ text: "  Calbo 500  " }, { text: "  " }, null, { text: 123 }],
    })).toBe("Calbo 500");
  });

  it("returns an empty string for malformed payloads", () => {
    expect(textFromPaddleResult(null)).toBe("");
    expect(textFromPaddleResult({})).toBe("");
    expect(textFromPaddleResult({ items: "not-an-array" })).toBe("");
  });
});
