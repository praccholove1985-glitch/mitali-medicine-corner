"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MobileCameraOCR } from "@/components/common/mobile-camera-ocr";
import { suggestInvoiceDetails, type InvoiceLineSuggestion } from "@/lib/camera-ocr-parsers";
import type { Locale } from "@/lib/i18n";

type DraftLine = InvoiceLineSuggestion & { key: string };
type Draft = { rawText: string; invoiceNumber: string; invoiceDate: string; lines: DraftLine[] };

type Props = {
  locale: Locale;
  today: string;
  onUseHeader: (invoiceNumber: string, invoiceDate: string) => void;
  onAddLines: (draft: { invoiceNumber: string; invoiceDate: string; lines: InvoiceLineSuggestion[] }) => void;
};

export function InvoiceCameraImport({ locale, today, onUseHeader, onAddLines }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const keyCounter = useRef(0);
  const bn = locale === "bn";
  const text = (en: string, bangla: string) => bn ? bangla : en;

  function readInvoice(rawText: string) {
    const details = suggestInvoiceDetails(rawText);
    setDraft({
      rawText,
      invoiceNumber: details.invoiceNumber,
      invoiceDate: details.invoiceDate && details.invoiceDate <= today ? details.invoiceDate : "",
      lines: details.lines.map((line) => ({ ...line, key: `scan-${++keyCounter.current}` })),
    });
  }

  function patchHeader(patch: Partial<Pick<Draft, "invoiceNumber" | "invoiceDate">>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function patchLine(key: string, patch: Partial<InvoiceLineSuggestion>) {
    setDraft((current) => current ? {
      ...current,
      lines: current.lines.map((line) => line.key === key ? { ...line, ...patch } : line),
    } : current);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-base">{text("Scan the whole supplier invoice", "পুরো সরবরাহকারী ইনভয়েস স্ক্যান করুন")}</CardTitle>
          <CardDescription className="mt-1">
            {text(
              "Capture the full page with your phone camera. It will suggest the invoice number, date and item rows to speed up stock entry.",
              "মোবাইল ক্যামেরায় পুরো পৃষ্ঠার ছবি তুলুন। স্টক এন্ট্রি দ্রুত করতে ইনভয়েস নম্বর, তারিখ ও আইটেমের সারি শনাক্ত করার চেষ্টা করবে।",
            )}
          </CardDescription>
        </div>
        <MobileCameraOCR
          mode="invoice"
          locale={locale}
          label={text("Scan invoice with phone", "মোবাইল দিয়ে ইনভয়েস স্ক্যান")}
          onExtracted={readInvoice}
        />
      </Card>

      {draft ? (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>{text("Review scanned invoice", "স্ক্যান করা ইনভয়েস যাচাই করুন")}</CardTitle>
            <CardDescription>
              {text(
                "This is a draft only. OCR can misread columns, medicines and prices. Nothing has been saved or added to stock.",
                "এটি শুধু একটি খসড়া। OCR পণ্যের নাম, কলাম ও দাম ভুল পড়তে পারে। এখনো কিছু সংরক্ষণ বা স্টকে যোগ হয়নি।",
              )}
            </CardDescription>
            <details className="mt-2 rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">{text("Full text read from invoice", "ইনভয়েস থেকে পড়া সম্পূর্ণ লেখা")}</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{draft.rawText}</pre>
            </details>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={text("Suggested invoice number", "প্রস্তাবিত ইনভয়েস নম্বর")} htmlFor="ocr-invoice-number">
                <Input id="ocr-invoice-number" value={draft.invoiceNumber} maxLength={64} onChange={(event) => patchHeader({ invoiceNumber: event.target.value })} />
              </Field>
              <Field label={text("Suggested invoice date", "প্রস্তাবিত ইনভয়েস তারিখ")} htmlFor="ocr-invoice-date">
                <Input id="ocr-invoice-date" type="date" max={today} value={draft.invoiceDate} onChange={(event) => patchHeader({ invoiceDate: event.target.value })} />
              </Field>
            </div>

            <h3 className="text-sm font-semibold">
              {text("Detected item rows", "শনাক্ত করা আইটেমের সারি")} ({draft.lines.length})
            </h3>
            {draft.lines.length ? draft.lines.map((line, index) => (
              <div key={line.key} className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
                <Field label={text(`Item ${index + 1}: name/description`, `আইটেম ${index + 1}: নাম/বিবরণ`)} htmlFor={`ocr-line-${line.key}-description`}>
                  <Input id={`ocr-line-${line.key}-description`} value={line.description} onChange={(event) => patchLine(line.key, { description: event.target.value })} />
                </Field>
                <Field label={text("Quantity", "পরিমাণ")} htmlFor={`ocr-line-${line.key}-quantity`}>
                  <Input id={`ocr-line-${line.key}-quantity`} inputMode="numeric" value={line.quantity} onChange={(event) => patchLine(line.key, { quantity: event.target.value })} />
                </Field>
                <Field label={text("Unit purchase cost", "একক ক্রয়মূল্য")} htmlFor={`ocr-line-${line.key}-cost`}>
                  <Input id={`ocr-line-${line.key}-cost`} inputMode="decimal" value={line.unitCost} onChange={(event) => patchLine(line.key, { unitCost: event.target.value })} />
                </Field>
              </div>
            )) : (
              <Alert tone="warning" title={text("No item rows were detected", "কোনো আইটেমের সারি শনাক্ত হয়নি")}>
                {text(
                  "Try a clearer photo with the full table in frame, or add items manually below.",
                  "পুরো টেবিলসহ পরিষ্কার ছবি তুলুন, অথবা নিচের ফর্মে পণ্য হাতে যোগ করুন।",
                )}
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              {text(
                "After adding these draft lines, select the correct catalogue product for each row. Confirm batch number, expiry date and actual purchase cost before recording the purchase.",
                "ড্রাফটে সারি যোগ করার পর প্রতিটি সারির জন্য ক্যাটালগ থেকে সঠিক পণ্য বেছে নিন। ক্রয় রেকর্ড করার আগে ব্যাচ নম্বর, মেয়াদ ও প্রকৃত ক্রয়মূল্য যাচাই করুন।",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!draft.invoiceNumber.trim() && !draft.invoiceDate} onClick={() => onUseHeader(draft.invoiceNumber, draft.invoiceDate)}>
                {text("Use invoice number/date", "ইনভয়েস নম্বর/তারিখ বসান")}
              </Button>
              <Button type="button" disabled={!draft.lines.some((line) => line.description.trim())} onClick={() => {
                onAddLines({
                  invoiceNumber: draft.invoiceNumber,
                  invoiceDate: draft.invoiceDate,
                  lines: draft.lines.map(({ key: _key, ...line }) => line),
                });
                setDraft(null);
              }}>
                {text("Add lines to stock draft", "স্টক ড্রাফটে আইটেম যোগ করুন")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>{text("Discard scan", "স্ক্যান বাতিল")}</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
