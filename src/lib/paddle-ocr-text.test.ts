import { describe, expect, it } from "vitest";
import { extractPaddleOcrText } from "./paddle-ocr-text";

describe("Paddle-based browser OCR text extraction", () => {
  it("preserves recognized medicine label lines in order", () => {
    expect(extractPaddleOcrText({
      texts: [
        { text: "ZIMAX 500", score: 0.98, frame: { top: 20, left: 10, width: 100, height: 25 } },
        { text: "Azithromycin 500 mg", score: 0.94, frame: { top: 55, left: 10, width: 180, height: 25 } },
        { text: "SQUARE", score: 0.91, frame: { top: 95, left: 10, width: 80, height: 25 } },
      ],
    })).toBe("ZIMAX 500\nAzithromycin 500 mg\nSQUARE");
  });

  it("ignores blank and non-text detections", () => {
    expect(extractPaddleOcrText({
      texts: [{ text: "  Calbo 500  " }, { text: "  " }, null, { text: 123 }],
    })).toBe("Calbo 500");
  });

  it("returns an empty string for malformed responses", () => {
    expect(extractPaddleOcrText(null)).toBe("");
    expect(extractPaddleOcrText({})).toBe("");
    expect(extractPaddleOcrText({ texts: "not-an-array" })).toBe("");
  });
});
