import { CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import type { ContractExtractableField } from "@/domain/extraction/extractable-fields";

function groupAmountDigits(value: string): string {
  const [integerPart, fractionPart] = value.split(".");
  const grouped = (integerPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionPart ? `${grouped}.${fractionPart}` : grouped;
}

/** Presentational only - never used to decide what gets applied to the contract (see apply-approved-suggestions.ts for that). */
export function formatSuggestionValue(
  fieldKey: ContractExtractableField,
  value: unknown
): string {
  if (!value || typeof value !== "object") {
    return "-";
  }
  const record = value as Record<string, unknown>;

  if (fieldKey === "counterpartyName") {
    return typeof record.name === "string" ? record.name : "-";
  }

  const raw = record.value;
  switch (fieldKey) {
    case "autoRenewal":
      if (raw === true) return "예";
      if (raw === false) return "아니오";
      return "-";
    case "contractType":
      return typeof raw === "string"
        ? (CONTRACT_TYPE_LABELS as Record<string, string>)[raw] ?? raw
        : "-";
    case "amount":
      return typeof raw === "string" ? groupAmountDigits(raw) : "-";
    default:
      return typeof raw === "string" || typeof raw === "number" ? String(raw) : "-";
  }
}
