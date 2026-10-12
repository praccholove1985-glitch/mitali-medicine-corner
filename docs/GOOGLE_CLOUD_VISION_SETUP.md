# Google Cloud Vision OCR setup

The medicine scanner uses Google Cloud Vision for the primary text-recognition pass when configured, and falls back to on-device Tesseract OCR if the cloud service is unavailable.

## 1. Create a Vision API key

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a project and enable the **Cloud Vision API**.
3. Enable billing for that project if Google Cloud requires it for your account.
4. Create an API key under **APIs & Services → Credentials**.
5. Restrict the key to the Cloud Vision API. Do not put the key in browser code or a `NEXT_PUBLIC_*` variable.

## 2. Add the key to Vercel

In the **mitali-pharmacy** project, open **Settings → Environment Variables** and add:

- **Name:** `GOOGLE_CLOUD_VISION_API_KEY`
- **Value:** your restricted Google Cloud Vision API key
- **Environments:** Production (and Preview if you test preview deployments)

Save the variable and redeploy the project. The key is read only by the server-side OCR endpoint and is never sent to the browser.

## 3. Test the scanner

Scan a medicine box or blister pack. The app sends a compressed image to Cloud Vision for text extraction and displays the result for review. If the key is missing, the request fails, or Cloud Vision cannot read text, the existing local OCR is used.

Cloud OCR sends the captured medicine-package image to Google for processing. OCR results are suggestions and should be checked before selecting a catalogue item.
