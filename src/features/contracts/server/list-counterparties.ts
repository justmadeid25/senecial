import { prisma } from "@/server/db/client";

export interface CounterpartyOption {
  id: string;
  name: string;
}

/**
 * Read-only helper for populating the contract form's counterparty select.
 * Not a full repository since Phase 3 does not add counterparty CRUD.
 */
export async function listCounterpartyOptions(
  organizationId: string
): Promise<CounterpartyOption[]> {
  return prisma.counterparty.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
