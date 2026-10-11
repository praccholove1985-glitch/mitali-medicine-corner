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

type OCRResult = { data: { text: string } };
type TesseractApi = {
  recognize(
    image: HTMLCanvasElement,
    languages: string,
    options?: { logger?: (message: { status?: string; progress?: number }) => void },
  ): Promise<OCRResult>;
};
type OCRWindow = Window & { Tesseract?: TesseractApi };

let tesseractPromise: Promise<TesseractApi> | null = null;

function loadTesseract(): Promise<TesseractApi> {
  const current = (window as OCRWindow).Tesseract;
  if (current?.recognize) return Promise.resolve(current);
  if (!tesseractPromise) {
    tesseractPromise = new Promise<TesseractApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-mmc-tesseract="true"]');
      const script = existing ?? document.createElement("script");
      const finish = () => {
        const api = (window as OCRWindow).Tesseract;
        if (api?.recognize) resolve(api);
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

type Props = {
  mode: "product" | "invoice";
  onExtracted: (text: string) => void;
  locale?: Locale;
  label?: string;
  size?: "sm" | "md";
  compactOnMobile?: boolean;
};

export function MobileCameraOCR({
  mode,
  onExtracted,
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

  useEffect(() => { onExtractedRef.current = onExtracted; }, [onExtracted]);

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
      const api = await loadTesseract();
      const result = await api.recognize(image as HTMLCanvasElement, "eng", {
        logger: (message) => {
          if (message.status === "recognizing text" && typeof message.progress === "number") {
            setProgress(Math.round(message.progress * 100));
          }
        },
      });
      const extracted = result.data.text.trim();
      if (!extracted) {
        setError(text(
          "No readable text was found. Move closer, improve the light, and try again.",
          "পড়ার মতো লেখা পাওয়া যায়নি। ক্যামেরা কাছে ধরুন, আলো বাড়ান, আবার চেষ্টা করুন।",
        ));
        return;
      }
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode === "invoice"
                ? text("Fit the full invoice page inside the camera view. Capture it to read the printed text. The result will be a draft for you to review, not a saved purchase.", "পুরো ইনভয়েসটি ক্যামেরার ফ্রেমে রাখুন। ছবি তুলে লেখা পড়ুন। ফলাফল শুধু যাচাই করার খসড়া হবে—কোনো ক্রয় স্বয়ংক্রিয়ভাবে সংরক্ষণ হবে না।")
                : text("Hold the package so its name, brand, strength and composition are sharp and well lit. The extracted details are suggestions for you to review.", "প্যাকেট এমনভাবে ধরুন যেন নাম, ব্র্যান্ড, শক্তি ও উপাদানের লেখা পরিষ্কার দেখা যায়। পড়া তথ্যগুলো যাচাই করার জন্য প্রস্তাব হিসেবে দেখানো হবে।")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-xl border bg-black">
              <video ref={videoRef} autoPlay muted playsInline className="aspect-[4/3] w-full object-contain" aria-label={text("Live camera view", "ক্যামেরার লাইভ দৃশ্য")} />
              <div className="pointer-events-none absolute inset-3 rounded-md border border-white/70" />
            </div>
            {cameraStatus === "starting" ? <p className="text-sm text-muted-foreground">{text("Starting camera…", "ক্যামেরা চালু হচ্ছে…")}</p> : null}
            {processing ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden />{text("Reading text", "লেখা পড়া হচ্ছে")}… {progress > 0 ? `${progress}%` : ""}</p>
            ) : null}
            {error ? <Alert tone="warning" title={text("Could not read this image", "ছবি পড়া যায়নি")}>{error}</Alert> : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button type="button" onClick={capturePhoto} disabled={cameraStatus !== "ready" || processing}>
                <Camera aria-hidden />{text("Capture and read", "ছবি তুলে লেখা পড়ুন")}
              </Button>
              <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
                <FileText className="size-4" aria-hidden />
                {text("Choose photo", "ছবি বেছে নিন")}
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={processing} onChange={(event) => { void readUploadedPhoto(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {text("Best results: English print, good light, hold steady and avoid glare. Keep the original invoice or package to verify every field before saving.", "ভালো ফলের জন্য পরিষ্কার ইংরেজি লেখা, পর্যাপ্ত আলো এবং স্থির ক্যামেরা ব্যবহার করুন। সংরক্ষণের আগে মূল ইনভয়েস বা প্যাকেটের সঙ্গে সব তথ্য মিলিয়ে নিন।")}
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
