export const MAX_OCR_IMAGE_BASE64_LENGTH = 3_500_000;

export type OcrImageMimeType = "image/jpeg" | "image/png" | "image/webp";

type VisionAnnotation = {
  description?: unknown;
};

type VisionApiResponse = {
  responses?: Array<{
    error?: { message?: unknown };
    fullTextAnnotation?: { text?: unknown };
    textAnnotations?: VisionAnnotation[];
  }>;
};

export function isSupportedOcrImageMimeType(value: unknown): value is OcrImageMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

/** Bound request size and reject malformed Base64 before contacting the OCR API. */
export function isValidOcrImageBase64(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 16 &&
    value.length <= MAX_OCR_IMAGE_BASE64_LENGTH &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Prefer ordered full text; use text annotations only when the structured text is absent. */
export function extractCloudVisionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as VisionApiResponse;
  const response = root.responses?.[0];
  if (!response || response.error) return "";

  const fullText = typeof response.fullTextAnnotation?.text === "string"
    ? response.fullTextAnnotation.text.trim()
    : "";
  const annotationText = response.textAnnotations?.find(
    (annotation) => typeof annotation.description === "string" && annotation.description.trim(),
  )?.description;
  const fallback = typeof annotationText === "string" ? annotationText.trim() : "";

  return fullText.length >= fallback.length ? fullText : fallback;
}
