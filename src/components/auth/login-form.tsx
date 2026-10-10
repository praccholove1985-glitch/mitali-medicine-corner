"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn, type SignInState } from "@/app/login/actions";

const initialState: SignInState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      {state.formError ? (
        <Alert tone="danger" title="Couldn't sign you in">
          {state.formError}
        </Alert>
      ) : null}

      <Field
        label="Email or phone number"
        htmlFor="identifier"
        error={state.fieldErrors?.identifier}
        required
      >
        <Input
          name="identifier"
          type="text"
          autoComplete="username"
          inputMode="email"
          placeholder="Email or 01753414080"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state.identifier}
          autoFocus
        />
      </Field>

      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password} required>
        <Input name="password" type="password" autoComplete="current-password" />
      </Field>

      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
