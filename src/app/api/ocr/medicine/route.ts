import { loadSession } from "@/server/session";
import {
  extractCloudVisionText,
  isSupportedOcrImageMimeType,
  isValidOcrImageBase64,
} from "@/lib/cloud-vision-ocr";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const requestsByUser = new Map<string, { startedAt: number; count: number }>();

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Best-effort per-instance guard against accidental high-volume OCR calls. */
function withinRateLimit(userId: string): boolean {
  const now = Date.now();
  const current = requestsByUser.get(userId);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    requestsByUser.set(userId, { startedAt: now, count: 1 });
  } else if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  } else {
    current.count += 1;
  }

  if (requestsByUser.size > 1_000) {
    for (const [id, window] of requestsByUser) {
      if (now - window.startedAt >= RATE_WINDOW_MS) requestsByUser.delete(id);
    }
  }
  return true;
}

export async function POST(request: Request) {
  let session;
  try {
    session = await loadSession();
  } catch {
    return json({ error: { code: "SESSION_ERROR", message: "Could not verify your session." } }, 503);
  }

  if (session.status !== "ready") {
    return json({ error: { code: "UNAUTHENTICATED", message: "Sign in to scan medicine labels." } }, 401);
  }
  if (!withinRateLimit(session.user.id)) {
    return json({ error: { code: "RATE_LIMITED", message: "Please wait a moment before scanning another image." } }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "INVALID_JSON", message: "The scan request was not valid." } }, 400);
  }

  if (!body || typeof body !== "object") {
    return json({ error: { code: "INVALID_REQUEST", message: "The scan request was not valid." } }, 400);
  }

  const imageBase64 = (body as { imageBase64?: unknown }).imageBase64;
  const mimeType = (body as { mimeType?: unknown }).mimeType;
  if (!isSupportedOcrImageMimeType(mimeType) || !isValidOcrImageBase64(imageBase64)) {
    return json({ error: { code: "INVALID_IMAGE", message: "Choose a clear JPEG, PNG, or WebP image under 2.5 MB." } }, 400);
  }

  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!apiKey) {
    return json({ configured: false, text: "", provider: "local-fallback" });
  }

  try {
    const upstream = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
            imageContext: { languageHints: ["en", "bn"] },
          }],
        }),
      },
    );

    if (!upstream.ok) {
      console.warn("Cloud Vision OCR returned HTTP", upstream.status);
      return json({ configured: true, text: "", provider: "google-cloud-vision", fallback: true });
    }

    const payload: unknown = await upstream.json();
    const text = extractCloudVisionText(payload);
    if (!text) {
      console.warn("Cloud Vision OCR returned no readable text");
      return json({ configured: true, text: "", provider: "google-cloud-vision", fallback: true });
    }

    return json({ configured: true, text, provider: "google-cloud-vision" });
  } catch (error) {
    console.warn("Cloud Vision OCR request failed", error instanceof Error ? error.name : "UnknownError");
    return json({ configured: true, text: "", provider: "google-cloud-vision", fallback: true });
  }
}
