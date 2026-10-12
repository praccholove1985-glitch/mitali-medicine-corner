# PaddleOCR.js setup

The medicine-label scanner uses the official PaddleOCR.js SDK with PP-OCRv5 inside the browser. It needs no cloud OCR API key. OCR models and ONNX Runtime Web assets download from their configured CDNs on first use; the captured medicine image itself remains in the browser. If PaddleOCR model loading or recognition fails, the existing local Tesseract OCR is used.

The initial engine is configured for English, matching the main brand and generic text on most medicine packaging. Bangla-script text may not be recognized reliably by this model. OCR output remains a draft for review; it does not automatically add a medicine to the sale.

The browser needs internet access to download PaddleOCR/ONNX model assets on first scan. The OCR result is processed locally after those assets are loaded.
