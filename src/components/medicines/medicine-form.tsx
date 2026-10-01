"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { saveMedicineAction, type FormState } from "@/app/(app)/medicines/actions";
import type { Catalogue, MedicineDetail } from "@/server/db/medicines";

type MedicineFormProps = {
  medicine: MedicineDetail | null;
  catalogue: Catalogue;
  /** Show and edit the sale price (needs price.edit). */
  canEditPrice: boolean;
  /** Show and edit the purchase price (needs price.edit and purchase.view_cost). */
  purchasePrice: { editable: true; value: string | null } | null;
};

const initialState: FormState = {};
const DOSAGE_FORMS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Cream", "Ointment", "Drops", "Inhaler", "Sachet", "Suppository"];
const UNITS = ["pcs", "strip", "bottle", "vial", "tube", "sachet", "box"];

export function MedicineForm({ medicine, catalogue, canEditPrice, purchasePrice }: MedicineFormProps) {
  const [state, formAction, pending] = useActionState(saveMedicineAction, initialState);
  const [categoryId, setCategoryId] = useState(state.values?.category_id ?? medicine?.categoryId ?? "");

  // What the user typed wins over the saved record after a failed submit.
  const v = (key: string, saved: string | number | null | undefined) =>
    state.values?.[key] ?? (saved === null || saved === undefined ? "" : String(saved));
  const err = state.fieldErrors ?? {};
  const subcategories = catalogue.subcategories.filter((s) => s.categoryId === categoryId && (s.isActive || s.id === medicine?.subcategoryId));
  const isEdit = medicine !== null;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {medicine ? <input type="hidden" name="id" value={medicine.id} /> : null}
      {canEditPrice ? <input type="hidden" name="has_sale_price_field" value="1" /> : null}
      {purchasePrice ? <input type="hidden" name="has_purchase_price_field" value="1" /> : null}

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
          <Field label="Barcode" htmlFor="barcode" error={err.barcode} hint="Click here and scan the pack">
            <Input name="barcode" inputMode="numeric" defaultValue={v("barcode", medicine?.barcode)} autoComplete="off" spellCheck={false} />
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
