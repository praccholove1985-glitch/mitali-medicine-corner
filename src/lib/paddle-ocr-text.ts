/** Extract recognized text lines from PaddleOCR.js results without assuming a particular SDK object shape. */
export function textFromPaddleResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const items = (result as { items?: unknown }).items;
  if (!Array.isArray(items)) return "";
  return items
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return "";
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}
