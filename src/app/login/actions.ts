"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { signInSchema } from "@/lib/validation/auth";
import { mapError } from "@/server/errors";

export type SignInState = {
  /** Field-level problems, keyed by field name. */
  fieldErrors?: { identifier?: string; password?: string };
  /** A problem with the attempt as a whole. */
  formError?: string;
  /** Echo the email or mobile number back on failure, never the password. */
  identifier?: string;
};

function toE164BangladeshPhone(input: string): string {
  const phone = input.trim().replace(/[\s()-]/g, "");
  if (phone.startsWith("+")) return phone;
  if (phone.startsWith("880")) return `+${phone}`;
  if (phone.startsWith("01")) return `+880${phone.slice(1)}`;
  return phone;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const parsed = signInSchema.safeParse({
    identifier,
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      identifier,
      fieldErrors: {
        identifier: flat.identifier?.[0],
        password: flat.password?.[0],
      },
    };
  }

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const loginIdentifier = parsed.data.identifier.trim();
  const password = parsed.data.password;

  // Supabase supports either email/password or phone/password. Do not try the
  // email value as a phone number: choose the matching auth method explicitly.
  const { error } = loginIdentifier.includes("@")
    ? await supabase.auth.signInWithPassword({
        email: loginIdentifier.toLowerCase(),
        password,
      })
    : await supabase.auth.signInWithPassword({
        phone: toE164BangladeshPhone(loginIdentifier),
        password,
      });

  if (error) {
    const mapped = mapError(error, "auth.signIn");
    // Keep authentication failures indistinguishable.
    const formError =
      mapped.code === "UNAUTHENTICATED" || mapped.code === "INVALID"
        ? "Email/mobile number or password is incorrect."
        : mapped.message;
    return { identifier, formError };
  }

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}
