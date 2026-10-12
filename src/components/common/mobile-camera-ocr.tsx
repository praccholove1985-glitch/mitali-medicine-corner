"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FileText, LoaderCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Locale } from "@/lib/i18n";

type OCRResult = { data: { text: string; confidence?: number } };
type OCRLoggerMessage = { status?: string; progress?: number };
type TesseractWorker = {
  setParameters(parameters: {
    tessedit_pageseg_mode: string;
    preserve_interword_spaces: string;
    user_defined_dpi: string;
  }): Promise<unknown>;
  recognize(image: HTMLCanvasElement): Promise<OCRResult>;
  terminate(): Promise<unknown>;
};
type TesseractApi = {
  createWorker(
    languages: string,
    engineMode?: number,
    options?: { logger?: (message: OCRLoggerMessage) => void },
  ): Promise<TesseractWorker>;
};
type OCRWindow = Window & {
  Tesseract?: TesseractApi;
  ZXingBrowser?: {
    BrowserMultiFormatReader: new () => {
      decodeFromCanvas(canvas: HTMLCanvasElement): { getText(): string };
    };
  };
  BarcodeDetector?: new (options?: { formats?: string[] }) => {
    detect(source: HTMLCanvasElement): Promise<Array<{ rawValue: string }>>;
  };
};

let barcodeLibraryPromise: Promise<NonNullable<OCRWindow["ZXingBrowser"]>> | null = null;

async function readBarcodeFromImage(canvas: HTMLCanvasElement): Promise<string | null> {
  const win = window as OCRWindow;
  if (win.BarcodeDetector) {
    try {
      const detector = new win.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"],
      });
      const results = await detector.detect(canvas);
      const value = results.find((result) => result.rawValue.trim())?.rawValue.trim();
      if (value) return value;
    } catch {
      // Fall back if this browser only supports a subset of barcode formats.
    }
  }

  try {
    if (!win.ZXingBrowser?.BrowserMultiFormatReader) {
      if (!barcodeLibraryPromise) {
        barcodeLibraryPromise = new Promise<NonNullable<OCRWindow["ZXingBrowser"]>>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>('script[data-mmc-zxing="true"]');
          const script = existing ?? document.createElement("script");
          const finish = () => {
            const api = (window as OCRWindow).ZXingBrowser;
            if (api?.BrowserMultiFormatReader) resolve(api);
            else reject(new Error("Barcode decoder did not load"));
          };
          script.addEventListener("load", finish, { once: true });
          script.addEventListener("error", () => reject(new Error("Barcode decoder did not load")), { once: true });
          if (!existing) {
            script.src = "https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js";
            script.async = true;
            script.dataset.mmcZxing = "true";
            document.head.appendChild(script);
          } else if ((window as OCRWindow).ZXingBrowser) finish();
        }).catch((error: unknown) => {
          barcodeLibraryPromise = null;
          throw error;
        });
      }
      await barcodeLibraryPromise;
    }
    const Reader = (window as OCRWindow).ZXingBrowser?.BrowserMultiFormatReader;
    if (!Reader) return null;
    return new Reader().decodeFromCanvas(canvas).getText().trim() || null;
  } catch {
    // A photo may contain readable label text but no barcode.
    return null;
  }
}

let tesseractPromise: Promise<TesseractApi> | null = null;

function loadTesseract(): Promise<TesseractApi> {
  const current = (window as OCRWindow).Tesseract;
  if (current?.createWorker) return Promise.resolve(current);
  if (!tesseractPromise) {
    tesseractPromise = new Promise<TesseractApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-mmc-tesseract="true"]');
      const script = existing ?? document.createElement("script");
      const finish = () => {
        const api = (window as OCRWindow).Tesseract;
        if (api?.createWorker) resolve(api);
        else {
          script.remove();
          reject(new Error("The text reader could not load. Check your internet connection and try again."));
        }
      };
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", () => {
        script.remove();
        reject(new Error("The text reader could not load. Check your internet connection and try again."));
      }, { once: true });
      if (!existing) {
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        script.async = true;
        script.dataset.mmcTesseract = "true";
        document.head.appendChild(script);
      } else if ((window as OCRWindow).Tesseract) {
        finish();
      }
    }).catch((error: unknown) => {
      tesseractPromise = null;
      throw error;
    });
  }
  return tesseractPromise;
}

function prepareImageForTextRecognition(image: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  const sourceWidth = image instanceof HTMLCanvasElement ? image.width : image.naturalWidth;
  const sourceHeight = image instanceof HTMLCanvasElement ? image.height : image.naturalHeight;
  const longestSide = Math.max(sourceWidth, sourceHeight, 1);
  // Upscale small labels, but cap memory use for large phone photos and invoices.
  const scale = Math.min(2.4, 2800 / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not prepare the photo for text recognition.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // Pack text is often coloured, small, or low contrast. Grayscale and contrast
  // enhancement help OCR without thresholding fine letters away.
  context.filter = "grayscale(1) contrast(1.4) brightness(1.04)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
  return canvas;
}

function createLabelOcrRegion(image: HTMLCanvasElement, index: number): HTMLCanvasElement {
  const width = image.width;
  const height = image.height;
  // Crop the already-enhanced image rather than the smaller camera canvas.
  // This gives label characters more pixels per OCR pass without holding four
  // large crop canvases in memory at the same time on a phone.
  const regionWidth = Math.max(1, Math.round(width * 0.72));
  const regionHeight = Math.max(1, Math.round(height * 0.72));
  const maxX = Math.max(0, width - regionWidth);
  const maxY = Math.max(0, height - regionHeight);
  const starts: Array<[number, number]> = [
    [0, 0],
    [maxX, 0],
    [0, maxY],
    [maxX, maxY],
  ];
  const [x, y] = starts[Math.max(0, Math.min(starts.length - 1, index))];
  const crop = document.createElement("canvas");
  crop.width = regionWidth;
  crop.height = regionHeight;
  const context = crop.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not prepare a close-up of the package text.");
  context.drawImage(image, x, y, regionWidth, regionHeight, 0, 0, regionWidth, regionHeight);
  return crop;
}

function mergeRecognizedText(primary: string, supplemental: string): string {
  const lines: string[] = [];
  const keys: string[] = [];

  const addLines = (value: string) => {
    for (const rawLine of value.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      const key = line.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (key.length < 2) continue;

      // Sparse-text OCR commonly repeats words with slightly different line breaks.
      // Keep the first version because the regular pass usually preserves better order.
      const duplicate = keys.some((existing) => {
        if (existing === key) return true;
        if (Math.min(existing.length, key.length) < 7) return false;
        const shorter = existing.length < key.length ? existing : key;
        const longer = existing.length < key.length ? key : existing;
        return longer.includes(shorter) && shorter.length / longer.length >= 0.76;
      });
      if (duplicate) continue;
      lines.push(line);
      keys.push(key);
    }
  };

  addLines(primary);
  addLines(supplemental);
  return lines.join("\n").trim();
}

type Props = {
  mode: "product" | "invoice";
  onExtracted: (text: string) => void;
  onBarcodeDetected?: (code: string) => Promise<boolean> | boolean;
  locale?: Locale;
  label?: string;
  size?: "sm" | "md";
  compactOnMobile?: boolean;
};

export function MobileCameraOCR({
  mode,
  onExtracted,
  onBarcodeDetected,
  locale = "en",
  label,
  size = "sm",
  compactOnMobile = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<"starting" | "ready" | "error">("starting");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onExtractedRef = useRef(onExtracted);
  const onBarcodeDetectedRef = useRef(onBarcodeDetected);

  useEffect(() => { onExtractedRef.current = onExtracted; }, [onExtracted]);
  useEffect(() => { onBarcodeDetectedRef.current = onBarcodeDetected; }, [onBarcodeDetected]);

  const isBn = locale === "bn";
  const text = (en: string, bn: string) => isBn ? bn : en;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraStatus("starting");
    setError(null);
    setProgress(0);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("error");
      setError(text(
        "Camera access requires a secure HTTPS connection and a supported browser. You can also upload a photo from your phone.",
        "ক্যামেরার জন্য নিরাপদ HTTPS সংযোগ ও সমর্থিত ব্রাউজার দরকার। চাইলে ফোন থেকে ছবিও বেছে নিতে পারেন।",
      ));
      return () => { cancelled = true; };
    }

    void navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    }).then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().then(() => {
          if (!cancelled) setCameraStatus("ready");
        }).catch(() => {
          if (!cancelled) setCameraStatus("ready");
        });
      } else {
        setCameraStatus("ready");
      }
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setCameraStatus("error");
      const message = cause instanceof Error ? cause.message.toLowerCase() : "";
      setError(message.includes("notallowed") || message.includes("permission")
        ? text("Camera permission was denied. Allow camera access in your browser settings and try again.", "ক্যামেরার অনুমতি দেওয়া হয়নি। ব্রাউজার সেটিংসে Camera access চালু করে আবার চেষ্টা করুন।")
        : text("The camera could not be started. Check permissions or choose a photo instead.", "ক্যামেরা চালু করা যায়নি। অনুমতি পরীক্ষা করুন অথবা ছবি বেছে নিন।"));
    });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [open, locale]);

  async function readImage(image: HTMLCanvasElement | HTMLImageElement) {
    setProcessing(true);
    setError(null);
    setProgress(0);
    try {
      if (onBarcodeDetectedRef.current) {
        const code = await readBarcodeFromImage(image as HTMLCanvasElement);
        if (code) {
          const handled = await onBarcodeDetectedRef.current(code);
          if (handled) {
            setOpen(false);
            return;
          }
        }
      }

      const api = await loadTesseract();
      const preparedImage = prepareImageForTextRecognition(image);
      const currentPass = { current: 0 };
      const worker = await api.createWorker("eng", 1, {
        logger: (message) => {
          if (message.status === "recognizing text" && typeof message.progress === "number") {
            // The whole-image passes take about 60% of the work; product-label
            // close-ups use the remaining progress. Invoice mode only runs two.
            const base = mode === "product" ? currentPass.current * 15 : currentPass.current * 50;
            const span = mode === "product" ? 15 : 50;
            setProgress(Math.min(99, Math.round(base + message.progress * span)));
          }
        },
      });

      const recognized: string[] = [];
      let passError: unknown = null;

      try {
        try {
          currentPass.current = 0;
          await worker.setParameters({
            tessedit_pageseg_mode: "3",
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          });
          const result = await worker.recognize(preparedImage);
          recognized.push(result.data.text);
        } catch (cause) {
          passError = cause;
        }

        try {
          currentPass.current = 1;
          await worker.setParameters({
            tessedit_pageseg_mode: "11",
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          });
          const result = await worker.recognize(preparedImage);
          recognized.push(result.data.text);
        } catch (cause) {
          passError = passError ?? cause;
        }

        if (mode === "product") {
          await worker.setParameters({
            tessedit_pageseg_mode: "11",
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          });
          for (let index = 0; index < 4; index += 1) {
            let region: HTMLCanvasElement | null = null;
            try {
              currentPass.current = index + 2;
              region = createLabelOcrRegion(preparedImage, index);
              const result = await worker.recognize(region);
              recognized.push(result.data.text);
            } catch (cause) {
              passError = passError ?? cause;
            } finally {
              if (region) {
                // Release each large crop before preparing the next one.
                region.width = 0;
                region.height = 0;
              }
            }
          }
        }
      } finally {
        await worker.terminate().catch(() => undefined);
      }

      const extracted = recognized.reduce(
        (combined, textPart) => mergeRecognizedText(combined, textPart),
        "",
      );
      if (!extracted) {
        if (passError) throw passError;
        setError(text(
          "No readable text was found. Move closer to the printed name/strength, hold steady, and try again.",
          "পড়ার মতো লেখা পাওয়া যায়নি। নাম/শক্তির লেখা কাছে এনে স্থিরভাবে ধরে আবার চেষ্টা করুন।",
        ));
        return;
      }
      setProgress(100);
      onExtractedRef.current(extracted);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("Could not read the image. Please try again.", "ছবি থেকে লেখা পড়া যায়নি। আবার চেষ্টা করুন।"));
    } finally {
      setProcessing(false);
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError(text("The camera is not ready yet.", "ক্যামেরা এখনো প্রস্তুত নয়।"));
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2000 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError(text("Could not capture an image on this device.", "এই ডিভাইসে ছবি নেওয়া যায়নি।"));
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    void readImage(canvas);
  }

  async function readUploadedPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(text("Choose an image file.", "একটি ছবির ফাইল বেছে নিন।"));
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2000 / bitmap.width);
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        throw new Error("Could not prepare the image on this device.");
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      await readImage(canvas);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("Could not open this photo.", "ছবিটি খোলা যায়নি।"));
    }
  }

  const title = mode === "invoice"
    ? text("Scan a supplier invoice", "সরবরাহকারীর ইনভয়েস স্ক্যান করুন")
    : text("Read the product label", "পণ্যের গায়ের লেখা পড়ুন");

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        aria-label={label ?? (mode === "invoice" ? text("Scan invoice", "ইনভয়েস স্ক্যান") : text("Scan product text", "পণ্যের লেখা স্ক্যান"))}
        title={label ?? (mode === "invoice" ? text("Scan invoice", "ইনভয়েস স্ক্যান") : text("Scan product text", "পণ্যের লেখা স্ক্যান"))}
        className={compactOnMobile ? "max-sm:size-10 max-sm:px-0" : undefined}
      >
        {mode === "invoice" ? <FileText aria-hidden /> : <Camera aria-hidden />}
        <span className={compactOnMobile ? "max-sm:sr-only sm:inline" : undefined}>
          {label ?? (mode === "invoice" ? text("Scan invoice", "ইনভয়েস স্ক্যান") : text("Scan product text", "পণ্যের লেখা স্ক্যান"))}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={(value) => { if (!processing) setOpen(value); }}>
        <DialogContent
          className="top-0 left-0 right-0 bottom-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 sm:rounded-none"
          closeLabel={text("Close scanner", "স্ক্যানার বন্ধ করুন")}
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 pt-[calc(env(safe-area-inset-top)+0.8rem)] pb-3 pr-12 sm:px-6 sm:pt-5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode === "invoice"
                ? text("Fit the full invoice page inside the camera view. Capture it to read the printed text. The result will be a draft for you to review, not a saved purchase.", "পুরো ইনভয়েসটি ক্যামেরার ফ্রেমে রাখুন। ছবি তুলে লেখা পড়ুন। ফলাফল শুধু যাচাই করার খসড়া হবে—কোনো ক্রয় স্বয়ংক্রিয়ভাবে সংরক্ষণ হবে না।")
                : text("Hold the package so its name, brand, strength and composition are sharp and well lit. The extracted details are suggestions for you to review.", "প্যাকেট এমনভাবে ধরুন যেন নাম, ব্র্যান্ড, শক্তি ও উপাদানের লেখা পরিষ্কার দেখা যায়। পড়া তথ্যগুলো যাচাই করার জন্য প্রস্তাব হিসেবে দেখানো হবে।")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-5">
            <div className="relative min-h-[42dvh] flex-1 overflow-hidden rounded-xl border bg-black sm:min-h-0">
              <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-contain" aria-label={text("Live camera view", "ক্যামেরার লাইভ দৃশ্য")} />
              <div className="pointer-events-none absolute inset-3 rounded-md border border-white/60" />
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white">
                {mode === "invoice"
                  ? text("Fit the full page in the frame", "পুরো পৃষ্ঠা ফ্রেমে রাখুন")
                  : text("Fit the full pack in the frame", "পুরো প্যাকেট ফ্রেমে রাখুন")}
              </div>
            </div>
            {cameraStatus === "starting" ? <p className="text-sm text-muted-foreground">{text("Starting camera…", "ক্যামেরা চালু হচ্ছে…")}</p> : null}
            {processing ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden />{text("Reading text", "লেখা পড়া হচ্ছে")}… {progress > 0 ? `${progress}%` : ""}</p>
            ) : null}
            {error ? <Alert tone="warning" title={text("Could not read this image", "ছবি পড়া যায়নি")}>{error}</Alert> : null}
            <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Button type="button" size="lg" onClick={capturePhoto} disabled={cameraStatus !== "ready" || processing} className="min-h-12">
                <Camera aria-hidden />{text("Capture full image · read barcode and text", "পুরো ছবি তুলুন · বারকোড ও লেখা পড়ুন")}
              </Button>
              <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-muted">
                <FileText className="size-4" aria-hidden />
                {text("Choose photo", "ছবি বেছে নিন")}
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={processing} onChange={(event) => { void readUploadedPhoto(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {text("One capture checks the barcode and reads the printed label. Keep the whole package in the frame, use bright light and avoid glare. Results are suggestions to review.", "একবার ছবি তুললেই বারকোড ও প্যাকেটের লেখা পড়ার চেষ্টা করবে। পুরো প্যাকেট ফ্রেমে রাখুন, আলো বাড়ান এবং ঝলক এড়িয়ে চলুন। ফলাফল যাচাই করে নিন।")}
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="outline" disabled={processing} onClick={() => setOpen(false)}>{text("Close", "বন্ধ করুন")}</Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
