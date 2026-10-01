"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { signInSchema } from "@/lib/validation/auth";
import { mapError } from "@/server/errors";

export type SignInState = {
  /** Field-level problems, keyed by field name. */
  fieldErrors?: { email?: string; password?: string };
  /** A problem with the attempt as a whole. */
  formError?: string;
  /** Echoed back so the email field is not cleared on failure. Never the password. */
  email?: string;
};

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const parsed = signInSchema.safeParse({
    email,
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      email,
      fieldErrors: { email: flat.email?.[0], password: flat.password?.[0] },
    };
  }

  const supabase = await createClient();
  if (!supabase) redirect("/setup");

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const mapped = mapError(error, "auth.signIn");
    // Wrong password and unknown email must be indistinguishable.
    const formError =
      mapped.code === "UNAUTHENTICATED" || mapped.code === "INVALID"
        ? "Email or password is incorrect."
        : mapped.message;
    return { email: parsed.data.email, formError };
  }

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}
