"use client";

import { useActionState, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { MobileBarcodeScanner } from "@/components/common/mobile-barcode-scanner";
import { MobileCameraOCR } from "@/components/common/mobile-camera-ocr";
import { suggestProductLabelDetails, type ProductLabelSuggestions } from "@/lib/camera-ocr-parsers";
import type { Locale } from "@/lib/i18n";
import { saveMedicineAction, type FormState } from "@/app/(app)/medicines/actions";
import type { Catalogue, MedicineDetail } from "@/server/db/medicines";

type MedicineFormProps = {
  medicine: MedicineDetail | null;
  initialBarcode?: string;
  catalogue: Catalogue;
  /** Show and edit the sale price (needs price.edit). */
  canEditPrice: boolean;
  /** Show and edit the purchase price (needs price.edit and purchase.view_cost). */
  purchasePrice: { editable: true; value: string | null } | null;
  locale?: Locale;
};

const initialState: FormState = {};
const DOSAGE_FORMS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Cream", "Ointment", "Drops", "Inhaler", "Sachet", "Suppository"];
const UNITS = ["pcs", "strip", "bottle", "vial", "tube", "sachet", "box"];

export function MedicineForm({ medicine, initialBarcode = "", catalogue, canEditPrice, purchasePrice, locale = "en" }: MedicineFormProps) {
  const [state, formAction, pending] = useActionState(saveMedicineAction, initialState);
  const [categoryId, setCategoryId] = useState(state.values?.category_id ?? medicine?.categoryId ?? "");
  const barcodeRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [labelDraft, setLabelDraft] = useState<{ rawText: string; details: ProductLabelSuggestions } | null>(null);\n  const [labelNotice, setLabelNotice] = useState<string | null>(null);

  // What the user typed wins over the saved record after a failed submit.
  const v = (key: string, saved: string | number | null | undefined) =>
    state.values?.[key] ?? (saved === null || saved === undefined ? "" : String(saved));
  const err = state.fieldErrors ?? {};
  const subcategories = catalogue.subcategories.filter((s) => s.categoryId === categoryId && (s.isActive || s.id === medicine?.subcategoryId));
  const isEdit = medicine !== null;

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      {medicine ? <input type="hidden" name="id" value={medicine.id} /> : null}
      {canEditPrice ? <input type="hidden" name="has_sale_price_field" value="1" /> : null}
      {purchasePrice ? <input type="hidden" name="has_purchase_price_field" value="1" /> : null}

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-base">{locale === "bn" ? "মোবাইল ক্যামেরায় পণ্যের লেখা পড়ুন" : "Read the product label with your phone"}</CardTitle>
          <CardDescription className="mt-1">
            {locale === "bn"
              ? "বারকোড ছাড়াও নাম, ব্র্যান্ড, জেনেরিক, শক্তি ও প্রস্তুতকারকের লেখা পড়ে ফর্মে প্রস্তাব দিতে পারে। সংরক্ষণের আগে যাচাই করুন।"
              : "Read printed name, brand, generic, strength and manufacturer details from a pack. Review the suggestions before saving."}
          </CardDescription>
        </div>
        <MobileCameraOCR
          mode="product"
          locale={locale}
          label={locale === "bn" ? "পণ্যের লেখা স্ক্যান" : "Scan product label"}
          onExtracted={(rawText) => {
            setLabelDraft({ rawText, details: suggestProductLabelDetails(rawText) });
            setLabelNotice(null);
          }}
        />
      </Card>
      {labelDraft ? (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>{locale === "bn" ? "স্ক্যান করা তথ্য যাচাই করুন" : "Review scanned product details"}</CardTitle>
            <CardDescription>
              {locale === "bn"
                ? "OCR ভুল করতে পারে। নিচের প্রস্তাবগুলো ঠিক করে তারপর ফর্মে বসান। এতে কোনো পণ্য এখনো সংরক্ষণ হবে না।"
                : "Text recognition can be wrong. Correct these suggestions, then copy them into the form. Nothing is saved yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <details className="rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">{locale === "bn" ? "প্যাকেট থেকে পড়া সম্পূর্ণ লেখা" : "Full text read from the package"}</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{labelDraft.rawText}</pre>
            </details>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                ["name", locale === "bn" ? "পণ্যের নাম" : "Product name"],
                ["brandName", locale === "bn" ? "ব্র্যান্ড" : "Brand name"],
                ["genericName", locale === "bn" ? "জেনেরিক / উপাদান" : "Generic / ingredient"],
                ["strength", locale === "bn" ? "শক্তি" : "Strength"],
                ["dosageForm", locale === "bn" ? "ডোজ ফর্ম" : "Dosage form"],
                ["companyName", locale === "bn" ? "প্রস্তুতকারক" : "Manufacturer"],
              ] as Array<[keyof ProductLabelSuggestions, string]>).map(([key, label]) => (
                <Field key={key} label={label} htmlFor={`ocr-product-${key}`}>
                  <Input
                    id={`ocr-product-${key}`}
                    value={labelDraft.details[key]}
                    onChange={(event) => setLabelDraft((current) => current ? {
                      ...current,
                      details: { ...current.details, [key]: event.target.value },
                    } : current)}
                  />
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  const form = formRef.current;
                  if (!form || !labelDraft) return;
                  const values: Array<[string, string]> = [
                    ["name", labelDraft.details.name],
                    ["brand_name", labelDraft.details.brandName],
                    ["generic_name", labelDraft.details.genericName],
                    ["strength", labelDraft.details.strength],
                    ["dosage_form", labelDraft.details.dosageForm],
                  ];
                  for (const [name, value] of values) {
                    if (!value.trim()) continue;
                    const control = form.elements.namedItem(name);
                    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.value = value;
                  }
                  const wantedCompany = labelDraft.details.companyName.trim().toLowerCase();
                  if (wantedCompany) {
                    const control = form.elements.namedItem("company_id");
                    if (control instanceof HTMLSelectElement) {
                      const option = Array.from(control.options).find((item) =>
                        item.value !== "" && item.textContent?.trim().toLowerCase() &&
                        (item.textContent.trim().toLowerCase().includes(wantedCompany) ||
                          wantedCompany.includes(item.textContent.trim().toLowerCase()))
                      );
                      if (option) control.value = option.value;
                    }
                  }
                  setLabelDraft(null);
                  setLabelNotice(locale === "bn"
                    ? "প্রস্তাবিত তথ্য ফর্মে বসানো হয়েছে। সব তথ্য যাচাই করে সংরক্ষণ করুন।"
                    : "Suggestions copied into the form. Review every field before saving.");
                }}
              >
                {locale === "bn" ? "ফর্মে বসান" : "Use suggestions"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLabelDraft(null)}>
                {locale === "bn" ? "বাতিল" : "Discard"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {labelNotice ? <Alert tone="info" title={locale === "bn" ? "ফর্ম আপডেট হয়েছে" : "Form updated"}>{labelNotice}</Alert> : null}
      {state.error ? (
        <Alert tone="danger" title="Couldn't save">
          {state.error}
          {state.reference ? <span className="mt-1 block text-xs">Reference: <span className="font-mono">{state.reference}</span></span> : null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Identity</CardTitle>
            <CardDescription>How the medicine is named on the pack and in the shop</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required error={err.name} className="sm:col-span-2">
            <Input name="name" defaultValue={v("name", medicine?.name)} autoComplete="off" />
          </Field>
          <Field label="Generic name" htmlFor="generic_name" error={err.generic_name}>
            <Input name="generic_name" defaultValue={v("generic_name", medicine?.genericName)} autoComplete="off" />
          </Field>
          <Field label="Brand name" htmlFor="brand_name" error={err.brand_name}>
            <Input name="brand_name" defaultValue={v("brand_name", medicine?.brandName)} autoComplete="off" />
          </Field>
          <Field label="Strength" htmlFor="strength" error={err.strength} hint="e.g. 500mg, 5mg/5ml">
            <Input name="strength" defaultValue={v("strength", medicine?.strength)} autoComplete="off" />
          </Field>
          <Field label="Dosage form" htmlFor="dosage_form" error={err.dosage_form}>
            <Input name="dosage_form" list="dosage-forms" defaultValue={v("dosage_form", medicine?.dosageForm)} autoComplete="off" />
          </Field>
          <datalist id="dosage-forms">
            {DOSAGE_FORMS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <Field label="Company" htmlFor="company_id" error={err.company_id}>
            <Select name="company_id" defaultValue={v("company_id", medicine?.companyId)}>
              <option value="">None</option>
              {catalogue.companies
                .filter((c) => c.isActive || c.id === medicine?.companyId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="category_id" error={err.category_id}>
            <Select
              name="category_id"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">None</option>
              {catalogue.categories
                .filter((c) => c.isActive || c.id === medicine?.categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Subcategory" htmlFor="subcategory_id" error={err.subcategory_id} hint={categoryId ? undefined : "Choose a category first."}>
            <Select
              key={categoryId}
              name="subcategory_id"
              defaultValue={categoryId === (medicine?.categoryId ?? "") ? v("subcategory_id", medicine?.subcategoryId) : ""}
              disabled={!categoryId}
            >
              <option value="">None</option>
              {subcategories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Packaging and codes</CardTitle>
            <CardDescription>Stock is counted in single units; pack size says how many make a pack</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Unit" htmlFor="unit" required error={err.unit}>
            <Input name="unit" list="units" defaultValue={v("unit", medicine?.unit ?? "pcs")} autoComplete="off" />
          </Field>
          <datalist id="units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <Field label="Pack size" htmlFor="pack_size" error={err.pack_size} hint="Units in one pack, e.g. 10 tablets per strip">
            <Input name="pack_size" inputMode="numeric" defaultValue={v("pack_size", medicine?.packSize ?? 1)} />
          </Field>
          <Field label="Barcode" htmlFor="barcode" error={err.barcode} hint="Scan with the phone camera or type the code from the pack">
            <div className="flex min-w-0 items-center gap-2">
              <Input
                ref={barcodeRef}
                id="barcode"
                name="barcode"
                inputMode="numeric"
                defaultValue={v("barcode", medicine?.barcode ?? initialBarcode)}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1"
              />
              <MobileBarcodeScanner
                size="sm"
                onDetected={(code) => {
                  if (barcodeRef.current) {
                    barcodeRef.current.value = code;
                    barcodeRef.current.focus();
                  }
                }}
              />
            </div>
          </Field>
          <Field label="SKU" htmlFor="sku" error={err.sku} hint="Your own short code (optional)">
            <Input name="sku" defaultValue={v("sku", medicine?.sku)} autoComplete="off" spellCheck={false} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Prices and stock rules</CardTitle>
            <CardDescription>Amounts are per single unit, in taka</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="MRP" htmlFor="mrp" error={err.mrp} hint="Printed on the pack. Selling above it is blocked.">
            <Input name="mrp" inputMode="decimal" defaultValue={v("mrp", medicine?.mrp)} placeholder="0.00" />
          </Field>
          {canEditPrice ? (
            <Field label="Default sale price" htmlFor="default_sale_price" error={err.default_sale_price} hint="Used when a batch has no price of its own. Can't exceed the MRP.">
              <Input name="default_sale_price" inputMode="decimal" defaultValue={v("default_sale_price", medicine?.salePrice)} placeholder="0.00" />
            </Field>
          ) : null}
          {purchasePrice ? (
            <Field label="Default purchase price" htmlFor="default_purchase_price" error={err.default_purchase_price} hint="A reference only. Each batch keeps its own cost for profit.">
              <Input name="default_purchase_price" inputMode="decimal" defaultValue={v("default_purchase_price", purchasePrice.value)} placeholder="0.00" />
            </Field>
          ) : null}
          <Field label="Tax rate (%)" htmlFor="tax_rate" error={err.tax_rate} hint="VAT included in the sale price">
            <Input name="tax_rate" inputMode="decimal" defaultValue={v("tax_rate", medicine?.taxRate ?? "0")} />
          </Field>
          <Field label="Minimum stock" htmlFor="minimum_stock" error={err.minimum_stock} hint="Units to always keep">
            <Input name="minimum_stock" inputMode="numeric" defaultValue={v("minimum_stock", medicine?.minimumStock ?? 0)} />
          </Field>
          <Field label="Reorder level" htmlFor="reorder_level" error={err.reorder_level} hint="Flag as low stock at or below this">
            <Input name="reorder_level" inputMode="numeric" defaultValue={v("reorder_level", medicine?.reorderLevel ?? 0)} />
          </Field>
          {!canEditPrice ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Selling and purchase prices are set by someone with price permission.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Notes and status</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Description" htmlFor="description" error={err.description}>
            <Textarea name="description" defaultValue={v("description", medicine?.description)} />
          </Field>
          <Checkbox
            id="prescription_required"
            name="prescription_required"
            label="Prescription required"
            hint="Sold only with a prescription"
            defaultChecked={state.values ? state.values.prescription_required === "on" : (medicine?.prescriptionRequired ?? false)}
          />
          {isEdit ? (
            <Checkbox
              id="is_active"
              name="is_active"
              label="Active"
              hint="Untick to retire a medicine. Its history is kept, but it can't be sold or receive stock."
              defaultChecked={state.values ? state.values.is_active === "on" : (medicine?.isActive ?? true)}
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" size="lg" loading={pending}>
          {pending ? "Saving" : isEdit ? "Save changes" : "Add medicine"}
        </Button>
      </div>
    </form>
  );
}
