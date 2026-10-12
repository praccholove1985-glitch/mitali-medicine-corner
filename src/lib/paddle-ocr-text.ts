/** Extract text lines from Guten OCR/PaddleOCR output without assuming all metadata exists. */
export function extractPaddleOcrText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const lines = (result as { texts?: unknown }).texts;
  if (!Array.isArray(lines)) return "";
  return lines
    .map((line: unknown) => {
      if (!line || typeof line !== "object") return "";
      const text = (line as { text?: unknown }).text;
      return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}
