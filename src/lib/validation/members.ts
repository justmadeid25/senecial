import { z } from "zod";

import { MembershipRole } from "@/generated/prisma/enums";

export const memberRoleSchema = z.enum(
  [MembershipRole.OWNER, MembershipRole.MEMBER],
  "역할을 선택해 주세요."
);

export const changeMemberRoleSchema = z.object({
  role: memberRoleSchema,
});

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
