import { ContractType } from "@/generated/prisma/enums";

import type { ContractExtractableField } from "./extractable-fields";

/**
 * Final defense-in-depth check before a suggestion is persisted: even
 * though the deterministic development extractor already normalizes its
 * own output correctly, a future real provider's `normalizedValue` must
 * not be trusted blindly. A suggestion whose normalizedValue doesn't match
 * its fieldKey's expected shape is dropped rather than stored - never
 * silently coerced.
 */
export function isValidNormalizedSuggestionValue(
  fieldKey: ContractExtractableField,
  normalizedValue: unknown
): boolean {
  if (!normalizedValue || typeof normalizedValue !== "object") {
    return false;
  }
  const record = normalizedValue as Record<string, unknown>;

  switch (fieldKey) {
    case "startDate":
    case "endDate":
    case "signedDate": {
      const value = record.value;
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }
    case "amount": {
      const value = record.value;
      return typeof value === "string" && /^\d{1,12}(\.\d{1,2})?$/.test(value);
    }
    case "currency": {
      const value = record.value;
      return typeof value === "string" && /^[A-Z]{3}$/.test(value);
    }
    case "autoRenewal": {
      return typeof record.value === "boolean";
    }
    case "noticePeriodDays": {
      const value = record.value;
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3650;
    }
    case "contractType": {
      const value = record.value;
      return typeof value === "string" && (Object.values(ContractType) as string[]).includes(value);
    }
    case "title":
    case "contractNumber":
    case "governingLaw":
    case "jurisdiction": {
      const value = record.value;
      return typeof value === "string" && value.trim().length > 0 && value.length <= 500;
    }
    case "counterpartyName": {
      const value = record.name;
      return typeof value === "string" && value.trim().length > 0;
    }
    default:
      return false;
  }
}
