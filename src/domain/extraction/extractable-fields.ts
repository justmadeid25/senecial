/**
 * The only fields extraction is allowed to suggest. Deliberately excludes
 * userId, organizationId, status, deletedAt, createdAt, updatedAt, any
 * internal permission field, storageKey, and any auth/password data -
 * extraction never touches those.
 *
 * "counterpartyName" is a special case: it has no direct Contract column
 * (it maps to Counterparty via counterpartyId) and is never auto-linked or
 * auto-created - see features/extraction/server/apply-approved-suggestions.ts.
 */
export const CONTRACT_EXTRACTABLE_FIELDS = [
  "title",
  "contractNumber",
  "contractType",
  "startDate",
  "endDate",
  "signedDate",
  "autoRenewal",
  "noticePeriodDays",
  "amount",
  "currency",
  "governingLaw",
  "jurisdiction",
  "counterpartyName",
] as const;

export type ContractExtractableField = (typeof CONTRACT_EXTRACTABLE_FIELDS)[number];

export function isContractExtractableField(
  value: string
): value is ContractExtractableField {
  return (CONTRACT_EXTRACTABLE_FIELDS as readonly string[]).includes(value);
}
