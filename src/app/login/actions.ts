"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { signInSchema } from "@/lib/validation/auth";
import { mapError } from "@/server/errors";

export type SignInState = {
  /** Field-level problems, keyed by field name. */
  fieldErrors?: { phone?: string; password?: string };
  /** A problem with the attempt as a whole. */
  formError?: string;
  /** Echo the phone number back on failure, never the password. */
  phone?: string;
};

function toE164BangladeshPhone(input: string): string {
  const phone = input.trim().replace(/[\s()-]/g, "");
  if (phone.startsWith("+")) return phone;
  if (phone.startsWith("880")) return `+${phone}`;
  if (phone.startsWith("01")) return `+880${phone.slice(1)}`;
  return phone;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const phone = String(formData.get("phone") ?? "");
  const parsed = signInSchema.safeParse({
    phone,
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      phone,
      fieldErrors: { phone: flat.phone?.[0], password: flat.password?.[0] },
    };
  }

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.auth.signInWithPassword({
    phone: toE164BangladeshPhone(parsed.data.phone),
    password: parsed.data.password,
  });

  if (error) {
    const mapped = mapError(error, "auth.signIn");
    // Keep authentication failures indistinguishable.
    const formError =
      mapped.code === "UNAUTHENTICATED" || mapped.code === "INVALID"
        ? "Phone number or password is incorrect."
        : mapped.message;
    return { phone: parsed.data.phone, formError };
  }

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}
