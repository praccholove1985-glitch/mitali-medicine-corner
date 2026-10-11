"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode } from "lucide-react";
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

type ScanResult = { getText(): string };
type ScanControls = { stop(): void };
type MultiFormatReader = {
  decodeFromConstraints(
    constraints: MediaStreamConstraints,
    video: HTMLVideoElement,
    callback: (result: ScanResult | undefined, error: unknown, controls?: ScanControls) => void,
  ): Promise<ScanControls>;
};
type ZXingBrowser = { BrowserMultiFormatReader: new () => MultiFormatReader };
type ZXingWindow = Window & { ZXingBrowser?: ZXingBrowser };

let libraryPromise: Promise<ZXingBrowser> | null = null;

function loadScannerLibrary(): Promise<ZXingBrowser> {
  const current = (window as ZXingWindow).ZXingBrowser;
  if (current?.BrowserMultiFormatReader) return Promise.resolve(current);
  if (!libraryPromise) {
    libraryPromise = new Promise<ZXingBrowser>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-mmc-zxing="true"]');
      const script = existing ?? document.createElement("script");
      const finish = () => {
        const api = (window as ZXingWindow).ZXingBrowser;
        if (api?.BrowserMultiFormatReader) resolve(api);
        else {
          script.remove();
          reject(new Error("The camera scanner could not load. Check your internet connection and try again."));
        }
      };
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", () => {
        script.remove();
        reject(new Error("The camera scanner could not load. Check your internet connection and try again."));
      }, { once: true });
      if (!existing) {
        script.src = "https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js";
        script.async = true;
        script.dataset.mmcZxing = "true";
        document.head.appendChild(script);
      } else if ((window as ZXingWindow).ZXingBrowser) {
        finish();
      }
    }).catch((error: unknown) => {
      libraryPromise = null;
      throw error;
    });
  }
  return libraryPromise;
}

type Props = {
  onDetected: (code: string) => void;
  locale?: Locale;
  label?: string;
  size?: "sm" | "md";
  compactOnMobile?: boolean;
};

export function MobileBarcodeScanner({
  onDetected,
  locale = "en",
  label,
  size = "sm",
  compactOnMobile = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"loading" | "scanning" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);

  const text = (en: string, bn: string) => locale === "bn" ? bn : en;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let detected = false;
    let controls: ScanControls | null = null;
    setStatus("loading");
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError(text(
        "Camera access needs a secure HTTPS connection and a supported mobile browser. Use the typed barcode/search field instead.",
        "ক্যামেরা ব্যবহারের জন্য HTTPS সংযোগ ও সমর্থিত ব্রাউজার দরকার। আপাতত বারকোড লিখে বা সার্চ করে পণ্য খুঁজুন।",
      ));
      return () => { cancelled = true; };
    }

    void loadScannerLibrary()
      .then((api) => {
        if (cancelled || !videoRef.current) return null;
        const reader = new api.BrowserMultiFormatReader();
        setStatus("scanning");
        return reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result) => {
            if (cancelled || detected) return;
            const code = result?.getText().trim();
            if (!code) return;
            detected = true;
            onDetectedRef.current(code);
            setOpen(false);
          },
        );
      })
      .then((nextControls) => {
        if (nextControls && cancelled) nextControls.stop();
        else if (nextControls) controls = nextControls;
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStatus("error");
        const message = cause instanceof Error ? cause.message : "";
        if (message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed")) {
          setError(text(
            "Camera permission was denied. Allow camera access in your browser settings, then try again.",
            "ক্যামেরার অনুমতি দেওয়া হয়নি। ব্রাউজার সেটিংসে Camera access অনুমতি দিয়ে আবার চেষ্টা করুন।",
          ));
        } else if (message.toLowerCase().includes("notfound") || message.toLowerCase().includes("device")) {
          setError(text(
            "No available camera was found. Check your phone camera permissions or use manual search.",
            "কোনো ক্যামেরা পাওয়া যায়নি। ফোনের ক্যামেরার অনুমতি পরীক্ষা করুন অথবা সার্চ ব্যবহার করুন।",
          ));
        } else {
          setError(message || text("Could not start the camera. Close and try again.", "ক্যামেরা চালু করা যায়নি। বন্ধ করে আবার চেষ্টা করুন।"));
        }
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, locale]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        aria-label={label ?? text("Scan with phone", "মোবাইল ক্যামেরায় স্ক্যান")}
        title={label ?? text("Scan with phone", "মোবাইল ক্যামেরায় স্ক্যান")}
        className={compactOnMobile ? "max-sm:size-10 max-sm:px-0" : undefined}
      >
        <Camera aria-hidden />
        <span className={compactOnMobile ? "max-sm:sr-only sm:inline" : undefined}>
          {label ?? text("Scan with phone", "মোবাইল ক্যামেরায় স্ক্যান")}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{text("Scan a product barcode", "পণ্যের বারকোড স্ক্যান করুন")}</DialogTitle>
            <DialogDescription>
              {text(
                "Point the rear camera at the product's barcode. When the code is read, the product lookup starts automatically. Camera access is only used while this scanner is open.",
                "পণ্যের বারকোডের দিকে পেছনের ক্যামেরা ধরুন। কোড পড়া হলে পণ্য খোঁজা স্বয়ংক্রিয়ভাবে শুরু হবে। স্ক্যানার খোলা থাকলেই ক্যামেরা ব্যবহার হবে।",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-xl border bg-black">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                aria-label={text("Live phone camera preview", "মোবাইল ক্যামেরার লাইভ দৃশ্য")}
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="h-24 w-[82%] rounded-lg border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.22)]" />
              </div>
            </div>
            {status === "loading" ? (
              <p className="text-sm text-muted-foreground">{text("Starting camera… allow camera permission if prompted.", "ক্যামেরা চালু হচ্ছে… অনুমতি চাইলে Allow চাপুন।")}</p>
            ) : status === "scanning" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><ScanBarcode className="size-4" aria-hidden />{text("Hold the barcode steady inside the frame.", "বারকোডটি ফ্রেমের মধ্যে স্থির রাখুন।")}</p>
            ) : null}
            {error ? <Alert tone="warning" title={text("Scanner unavailable", "স্ক্যানার চালু হয়নি")}>{error}</Alert> : null}
            <p className="text-xs text-muted-foreground">
              {text("Works with supported Android and iPhone browsers over HTTPS. If a product has no barcode, search its name or add it to the catalogue first.", "HTTPS-এ সমর্থিত Android ও iPhone ব্রাউজারে কাজ করে। পণ্যে বারকোড না থাকলে নাম দিয়ে খুঁজুন বা আগে ক্যাটালগে যোগ করুন।")}
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{text("Close scanner", "স্ক্যানার বন্ধ করুন")}</Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
