import type { CounterpartyRow } from "@/server/repositories/counterparty-repository";

export interface CounterpartyDetail {
  id: string;
  name: string;
  businessNumber: string | null;
  representativeName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCounterpartyDetail(counterparty: CounterpartyRow): CounterpartyDetail {
  return {
    id: counterparty.id,
    name: counterparty.name,
    businessNumber: counterparty.businessNumber,
    representativeName: counterparty.representativeName,
    contactName: counterparty.contactName,
    contactEmail: counterparty.contactEmail,
    contactPhone: counterparty.contactPhone,
    memo: counterparty.memo,
    createdAt: counterparty.createdAt,
    updatedAt: counterparty.updatedAt,
  };
}

const COMPARABLE_FIELDS = [
  "name",
  "businessNumber",
  "representativeName",
  "contactName",
  "contactEmail",
  "contactPhone",
  "memo",
] as const;

interface ComparableUpdateInput {
  name?: string;
  businessNumber?: string;
  representativeName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  memo?: string;
}

/**
 * Field *names* only - never the before/after values themselves - for the
 * AuditLog metadata. Contact details and memo are considered sensitive
 * enough that even a diff value must never be logged, only which fields
 * changed. Mirrors getChangedContractFields() in contracts/server.
 */
export function getChangedCounterpartyFields(
  existing: CounterpartyRow,
  next: ComparableUpdateInput
): string[] {
  const changed: string[] = [];

  for (const field of COMPARABLE_FIELDS) {
    const existingValue = existing[field] ?? null;
    const nextValue = next[field] ?? null;
    if (existingValue !== nextValue) {
      changed.push(field);
    }
  }

  return changed;
}
