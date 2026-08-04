import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type PasswordResetTokenRow = Prisma.PasswordResetTokenGetPayload<Record<string, never>>;

export async function createPasswordResetToken(
  data: { userId: string; tokenHash: string; expiresAt: Date },
  client: DbClient = prisma
): Promise<PasswordResetTokenRow> {
  return client.passwordResetToken.create({ data });
}

export async function findPasswordResetTokenByHash(
  tokenHash: string,
  client: DbClient = prisma
): Promise<PasswordResetTokenRow | null> {
  return client.passwordResetToken.findUnique({ where: { tokenHash } });
}

export async function markPasswordResetTokenUsed(
  id: string,
  usedAt: Date,
  client: DbClient = prisma
): Promise<void> {
  await client.passwordResetToken.update({ where: { id }, data: { usedAt } });
}

/** §20 - "새 token 발급 시 이전 활성 token 무효화". */
export async function invalidateActivePasswordResetTokens(
  userId: string,
  now: Date,
  client: DbClient = prisma
): Promise<void> {
  await client.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: now },
  });
}
