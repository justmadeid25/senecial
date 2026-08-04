import { ValidationError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

/**
 * A counterpartyId supplied by the client must belong to the same
 * organization - otherwise a user could link a contract to another
 * organization's counterparty. Treated as a validation failure (not
 * NotFound) since it's the client's own input that's wrong.
 */
export async function assertCounterpartyBelongsToOrganization(
  counterpartyId: string,
  organizationId: string
): Promise<void> {
  const counterparty = await prisma.counterparty.findFirst({
    where: { id: counterpartyId, organizationId },
    select: { id: true },
  });

  if (!counterparty) {
    throw new ValidationError("선택한 상대방을 찾을 수 없습니다.");
  }
}
