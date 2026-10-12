import { describe, expect, it } from "vitest";
import {
  extractCloudVisionText,
  isSupportedOcrImageMimeType,
  isValidOcrImageBase64,
  MAX_OCR_IMAGE_BASE64_LENGTH,
} from "./cloud-vision-ocr";

describe("Cloud Vision OCR payload handling", () => {
  it("prefers structured full text because it preserves line order", () => {
    const text = extractCloudVisionText({
      responses: [{
        fullTextAnnotation: { text: "ZIMAX 500\nAzithromycin 500 mg\nSQUARE" },
        textAnnotations: [{ description: "ZIMAX 500 Azithromycin 500 mg SQUARE" }],
      }],
    });
    expect(text).toBe("ZIMAX 500\nAzithromycin 500 mg\nSQUARE");
  });

  it("uses text annotations when full text is missing", () => {
    expect(extractCloudVisionText({
      responses: [{ textAnnotations: [{ description: "Calbo 500" }] }],
    })).toBe("Calbo 500");
  });

  it("returns empty text for provider errors and malformed responses", () => {
    expect(extractCloudVisionText({ responses: [{ error: { message: "invalid key" } }] })).toBe("");
    expect(extractCloudVisionText(null)).toBe("");
    expect(extractCloudVisionText({})).toBe("");
  });

  it("accepts only supported image MIME types", () => {
    expect(isSupportedOcrImageMimeType("image/jpeg")).toBe(true);
    expect(isSupportedOcrImageMimeType("image/png")).toBe(true);
    expect(isSupportedOcrImageMimeType("image/webp")).toBe(true);
    expect(isSupportedOcrImageMimeType("text/plain")).toBe(false);
    expect(isSupportedOcrImageMimeType("image/svg+xml")).toBe(false);
  });

  it("rejects invalid and oversized base64 payloads", () => {
    expect(isValidOcrImageBase64("YWJjZGVmZ2hpamtsbW5vcA==")).toBe(true);
    expect(isValidOcrImageBase64("YWJj%%%=")).toBe(false);
    expect(isValidOcrImageBase64("short")).toBe(false);
    expect(isValidOcrImageBase64("A".repeat(MAX_OCR_IMAGE_BASE64_LENGTH + 4))).toBe(false);
  });
});
