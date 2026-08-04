import { z } from "zod";

import { MembershipRole } from "@/generated/prisma/enums";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/validation/auth";
import { memberRoleSchema } from "@/lib/validation/members";

export const invitationEmailSchema = emailSchema;

export const invitationRoleSchema = memberRoleSchema;

export const createInvitationSchema = z.object({
  email: invitationEmailSchema,
  role: invitationRoleSchema.optional().default(MembershipRole.MEMBER),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const registerAndAcceptInvitationSchema = z.object({
  name: nameSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
}).check((ctx) => {
  const data = ctx.value as { password?: string; confirmPassword?: string };
  if (data.password && data.confirmPassword && data.password !== data.confirmPassword) {
    ctx.issues.push({
      code: "custom",
      message: "비밀번호가 일치하지 않습니다.",
      path: ["confirmPassword"],
      input: data,
    });
  }
});

export type RegisterAndAcceptInvitationInput = z.infer<
  typeof registerAndAcceptInvitationSchema
>;
