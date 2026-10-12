import { z } from "zod";

const emailOrBangladeshMobile = z
  .string()
  .trim()
  .min(1, "Enter your email or mobile number.")
  .max(254, "Email or mobile number is too long.")
  .superRefine((value, context) => {
    if (value.includes("@")) {
      const emailResult = z.string().email().safeParse(value);
      if (!emailResult.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid email address.",
        });
      }
      return;
    }

    if (!/^(?:\+?8801[3-9]\d{8}|01[3-9]\d{8})$/.test(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid email address or Bangladesh mobile number.",
      });
    }
  });

export const signInSchema = z.object({
  identifier: emailOrBangladeshMobile,
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(256, "That password is too long."),
});

export type SignInInput = z.infer<typeof signInSchema>;
