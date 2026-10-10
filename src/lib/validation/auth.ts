import { z } from "zod";

export const signInSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, "Enter your phone number.")
    .max(20, "That phone number is too long.")
    .regex(
      /^(?:\+?8801[3-9]\d{8}|01[3-9]\d{8})$/,
      "Enter a valid Bangladesh mobile number.",
    ),
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(256, "That password is too long."),
});

export type SignInInput = z.infer<typeof signInSchema>;
