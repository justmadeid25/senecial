import { z } from "zod";

/**
 * Trims, lowercases, then validates as an email. Both client-side forms and
 * the register/login services parse through this schema, so the same
 * normalization (used later to look up the user by email) always applies.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("유효한 이메일 주소를 입력해 주세요."));

export const nameSchema = z
  .string()
  .trim()
  .min(2, "이름은 최소 2자 이상이어야 합니다.")
  .max(50, "이름은 최대 50자까지 입력할 수 있습니다.");

export const companyNameSchema = z
  .string()
  .trim()
  .min(2, "회사명은 최소 2자 이상이어야 합니다.")
  .max(100, "회사명은 최대 100자까지 입력할 수 있습니다.");

/**
 * Minimum 10 characters, must contain at least one letter and one digit.
 * No forced special-character complexity rule, per product decision.
 */
export const passwordSchema = z
  .string()
  .min(10, "비밀번호는 최소 10자 이상이어야 합니다.")
  .max(128, "비밀번호는 최대 128자까지 입력할 수 있습니다.")
  .refine(
    (value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value),
    "비밀번호는 영문자와 숫자를 포함해야 합니다."
  );

export const signupSchema = z
  .object({
    name: nameSchema,
    companyName: companyNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "비밀번호가 일치하지 않습니다.",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "비밀번호를 입력해 주세요."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "비밀번호가 일치하지 않습니다.",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
