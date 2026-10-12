# In-browser Paddle OCR setup

The medicine scanner uses Guten OCR, a browser-ready ONNX implementation based on PaddleOCR. It does not require a cloud OCR key and does not upload the captured medicine image to an OCR API. At build time, `scripts/fetch-ocr-models.mjs` downloads and verifies the three model assets into `public/models`; the app serves them from its own origin.

The browser OCR uses the PP-OCRv4 model with an English/Chinese character dictionary that includes Latin medicine names. It is aimed at product names, ingredient names, strengths and company marks printed in English. Bangla-script recognition is not guaranteed by this model. If Paddle OCR fails to load or read usable text, the current on-device Tesseract reader remains the fallback.

The OCR result is only a review draft. The user must confirm the product before selecting a catalogue item or adding it to a sale.
