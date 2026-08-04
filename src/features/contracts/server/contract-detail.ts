import type { ContractStatus, ContractType } from "@/generated/prisma/enums";
import { getComputedContractStatus } from "@/domain/contracts/get-computed-contract-status";
import type { ContractWithCounterparty } from "@/server/repositories/contract-repository";

export interface ContractDetail {
  id: string;
  title: string;
  contractNumber: string | null;
  contractType: ContractType;
  /** As persisted in the DB. */
  storedStatus: ContractStatus;
  /** Time-computed status to actually show the user. */
  displayStatus: ContractStatus;
  startDate: Date | null;
  endDate: Date | null;
  signedDate: Date | null;
  autoRenewal: boolean;
  noticePeriodDays: number | null;
  amount: string | null;
  currency: string | null;
  governingLaw: string | null;
  jurisdiction: string | null;
  description: string | null;
  counterparty: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toContractDetail(
  contract: ContractWithCounterparty,
  now: Date
): ContractDetail {
  return {
    id: contract.id,
    title: contract.title,
    contractNumber: contract.contractNumber,
    contractType: contract.contractType,
    storedStatus: contract.status,
    displayStatus: getComputedContractStatus(
      { status: contract.status, endDate: contract.endDate },
      now
    ),
    startDate: contract.startDate,
    endDate: contract.endDate,
    signedDate: contract.signedDate,
    autoRenewal: contract.autoRenewal,
    noticePeriodDays: contract.noticePeriodDays,
    amount: contract.amount ? contract.amount.toString() : null,
    currency: contract.currency,
    governingLaw: contract.governingLaw,
    jurisdiction: contract.jurisdiction,
    description: contract.description,
    counterparty: contract.counterparty,
    createdBy: contract.createdBy,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}

const COMPARABLE_SCALAR_FIELDS = [
  "title",
  "contractNumber",
  "contractType",
  "status",
  "autoRenewal",
  "noticePeriodDays",
  "currency",
  "governingLaw",
  "jurisdiction",
  "description",
  "counterpartyId",
] as const;

const COMPARABLE_DATE_FIELDS = ["startDate", "endDate", "signedDate"] as const;

interface ComparableUpdateInput {
  title?: string;
  contractNumber?: string;
  contractType?: ContractType;
  status?: ContractStatus;
  autoRenewal?: boolean;
  noticePeriodDays?: number | null;
  currency?: string;
  governingLaw?: string;
  jurisdiction?: string;
  description?: string;
  counterpartyId?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  signedDate?: Date | null;
  amount?: string;
}

/**
 * Field *names* only - never the before/after values themselves - for the
 * AuditLog metadata. Keeps audit records free of contract content.
 */
export function getChangedContractFields(
  existing: ContractWithCounterparty,
  next: ComparableUpdateInput
): string[] {
  const changed: string[] = [];

  for (const field of COMPARABLE_SCALAR_FIELDS) {
    const existingValue = existing[field] ?? null;
    const nextValue = next[field] ?? null;
    if (existingValue !== nextValue) {
      changed.push(field);
    }
  }

  for (const field of COMPARABLE_DATE_FIELDS) {
    const existingTime = existing[field]?.getTime() ?? null;
    const nextTime = next[field]?.getTime() ?? null;
    if (existingTime !== nextTime) {
      changed.push(field);
    }
  }

  const existingAmount = existing.amount ? existing.amount.toString() : null;
  const nextAmount = next.amount ?? null;
  if (existingAmount !== nextAmount) {
    changed.push("amount");
  }

  return changed;
}
