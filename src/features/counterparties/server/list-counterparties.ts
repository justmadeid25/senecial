import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { ValidationError } from "@/lib/errors";
import { counterpartyListQuerySchema } from "@/lib/validation/counterparties";
import {
  countCounterparties,
  findCounterparties,
} from "@/server/repositories/counterparty-repository";

import { toCounterpartyDetail, type CounterpartyDetail } from "./counterparty-detail";

export interface ListCounterpartiesParams {
  userId: string;
  organizationId: string;
  query: unknown;
}

export interface ListCounterpartiesResult {
  items: CounterpartyDetail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listCounterparties(
  params: ListCounterpartiesParams
): Promise<ListCounterpartiesResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = counterpartyListQuerySchema.safeParse(params.query);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "검색 조건이 올바르지 않습니다."
    );
  }
  const { q, page, pageSize } = parsed.data;

  const where = q
    ? { name: { contains: q, mode: "insensitive" as const } }
    : undefined;

  const [rows, total] = await Promise.all([
    findCounterparties({
      organizationId: authContext.organizationId,
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    countCounterparties({ organizationId: authContext.organizationId, where }),
  ]);

  return {
    items: rows.map(toCounterpartyDetail),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
