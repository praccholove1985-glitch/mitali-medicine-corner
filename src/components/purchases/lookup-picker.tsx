"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

type Props<T> = {
  label: string;
  placeholder: string;
  /** What is chosen now, shown in place of the search box. */
  selectedLabel: string | null;
  onClear: () => void;
  items: T[];
  loading: boolean;
  failed: boolean;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (item: T) => void;
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  emptyText: string;
  /** Injected by <Field> so the label, hint and error belong to the search box. */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
};

/** A search box with a result list; once something is chosen it shows that, with a way to change it. */
export function LookupPicker<T>({
  label, placeholder, selectedLabel, onClear, items, loading, failed, query, onQuery, onSelect, getKey, renderItem, emptyText, id: idProp,
  "aria-describedby": describedBy, "aria-invalid": invalid, "aria-required": required,
}: Props<T>) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [open, setOpen] = useState(false);

  if (selectedLabel !== null) {
    return (
      <div className="flex items-center gap-2">
        <Input id={id} value={selectedLabel} readOnly aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} className="min-w-0 flex-1 bg-muted/40 font-medium" />
        <button
          type="button"
          onClick={() => {
            onClear();
            onQuery("");
          }}
          className="flex size-9 shrink-0 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">Change {label.toLowerCase()}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-required={required}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
      />
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-label={`${label} results`} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card shadow-md">
          {failed ? (
            <li className="px-3 py-2 text-sm text-danger-text">Couldn&rsquo;t search. Check your connection.</li>
          ) : loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</li>
          ) : (
            items.map((item) => (
              <li key={getKey(item)} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-primary-soft focus-visible:bg-primary-soft"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  {renderItem(item)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
