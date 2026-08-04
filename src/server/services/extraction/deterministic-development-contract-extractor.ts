import type { ContractExtractableField } from "@/domain/extraction/extractable-fields";
import type {
  ContractFieldExtractionResult,
  ContractFieldExtractionService,
  ExtractedField,
} from "@/domain/extraction/field-extraction-service";
import {
  normalizeAmount,
  normalizeDate,
} from "@/domain/extraction/normalize-extracted-fields";

/**
 * Arbitrary, deliberately not-precise confidence for every suggestion this
 * extractor produces - it is regex pattern matching, not a real
 * model's calibrated probability. The review UI only ever shows a
 * 높음/보통/낮음 band derived from this, never claims a precise percentage.
 */
const DEV_EXTRACTOR_CONFIDENCE = 0.6;
const MAX_SOURCE_TEXT_LENGTH = 500;

function truncateSourceText(text: string): string {
  return text.length > MAX_SOURCE_TEXT_LENGTH
    ? `${text.slice(0, MAX_SOURCE_TEXT_LENGTH)}...`
    : text;
}

function findLabeledValue(
  text: string,
  labels: readonly string[]
): { line: string; value: string } | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`${label}\\s*[:：]\\s*(.+)`);
      const match = pattern.exec(line);
      if (match?.[1]) {
        return { line: line.trim(), value: match[1].trim() };
      }
    }
  }
  return null;
}

/**
 * !!! NOT A REAL AI MODEL - REGEX/RULE-BASED PATTERN MATCHING ONLY !!!
 *
 * Recognizes a small set of labeled Korean/English patterns
 * ("계약명: ...", "계약기간: ... ~ ...", "계약금액: ...원", "상대방: ...",
 * a bare "자동갱신" mention) so the entire extraction pipeline is
 * exercisable end-to-end without any LLM API key. Never presented to a
 * user as "AI" - always "개발용 규칙 기반 추출기" in UI copy and docs. See
 * getContractFieldExtractionService() for the production usage guard.
 */
export class DeterministicDevelopmentContractExtractor
  implements ContractFieldExtractionService
{
  async extract(input: {
    documentText: string;
    locale: "ko-KR";
    allowedFields: readonly ContractExtractableField[];
  }): Promise<ContractFieldExtractionResult> {
    const fields: ExtractedField[] = [];
    const warnings: string[] = [];
    const allowed = new Set(input.allowedFields);
    const text = input.documentText;

    if (allowed.has("title")) {
      const found = findLabeledValue(text, ["계약명", "Title"]);
      if (found) {
        fields.push({
          fieldKey: "title",
          rawValue: found.value,
          normalizedValue: { value: found.value },
          confidence: DEV_EXTRACTOR_CONFIDENCE,
          sourceText: truncateSourceText(found.line),
        });
      }
    }

    if (allowed.has("contractNumber")) {
      const found = findLabeledValue(text, ["계약번호"]);
      if (found) {
        fields.push({
          fieldKey: "contractNumber",
          rawValue: found.value,
          normalizedValue: { value: found.value },
          confidence: DEV_EXTRACTOR_CONFIDENCE,
          sourceText: truncateSourceText(found.line),
        });
      }
    }

    if (allowed.has("startDate") || allowed.has("endDate")) {
      const found = findLabeledValue(text, ["계약기간", "Period"]);
      if (found) {
        // A bare "-" is NOT a valid separator here - ISO/dot dates
        // ("2026-08-01") use "-" internally, so only a hyphen or "to" with
        // surrounding whitespace counts as a period separator. "~" and
        // "부터" are unambiguous and always split.
        const parts = found.value
          .split(/~|부터|(?<=\s)-(?=\s)|(?<=\s)to(?=\s)/i)
          .map((part) => part.trim())
          .filter(Boolean);
        const startRaw = parts[0];
        const endRaw = parts[1];

        if (allowed.has("startDate") && startRaw) {
          const normalized = normalizeDate(startRaw);
          if (normalized) {
            fields.push({
              fieldKey: "startDate",
              rawValue: startRaw,
              normalizedValue: { value: normalized.isoDate },
              confidence: DEV_EXTRACTOR_CONFIDENCE,
              sourceText: truncateSourceText(found.line),
            });
          } else {
            warnings.push(`시작일을 인식했지만 형식이 모호해 확정하지 못했습니다: "${startRaw}"`);
          }
        }

        if (allowed.has("endDate") && endRaw) {
          const normalized = normalizeDate(endRaw);
          if (normalized) {
            fields.push({
              fieldKey: "endDate",
              rawValue: endRaw,
              normalizedValue: { value: normalized.isoDate },
              confidence: DEV_EXTRACTOR_CONFIDENCE,
              sourceText: truncateSourceText(found.line),
            });
          } else {
            warnings.push(`종료일을 인식했지만 형식이 모호해 확정하지 못했습니다: "${endRaw}"`);
          }
        }
      }
    }

    if (allowed.has("amount") || allowed.has("currency")) {
      const found = findLabeledValue(text, ["계약금액", "금액", "Amount"]);
      if (found) {
        const normalized = normalizeAmount(found.value);
        if (normalized) {
          if (allowed.has("amount")) {
            fields.push({
              fieldKey: "amount",
              rawValue: found.value,
              normalizedValue: { value: normalized.amount },
              confidence: DEV_EXTRACTOR_CONFIDENCE,
              sourceText: truncateSourceText(found.line),
            });
          }
          if (allowed.has("currency") && normalized.currency) {
            fields.push({
              fieldKey: "currency",
              rawValue: found.value,
              normalizedValue: { value: normalized.currency },
              confidence: DEV_EXTRACTOR_CONFIDENCE,
              sourceText: truncateSourceText(found.line),
            });
          }
        } else {
          warnings.push(`금액으로 보이는 문구를 찾았지만 값을 확정하지 못했습니다: "${found.value}"`);
        }
      }
    }

    if (allowed.has("counterpartyName")) {
      const found = findLabeledValue(text, ["상대방", "거래상대방", "Counterparty"]);
      if (found) {
        fields.push({
          fieldKey: "counterpartyName",
          rawValue: found.value,
          normalizedValue: { name: found.value },
          confidence: DEV_EXTRACTOR_CONFIDENCE,
          sourceText: truncateSourceText(found.line),
        });
      }
    }

    if (allowed.has("autoRenewal")) {
      const lines = text.split(/\r?\n/);
      const matchingLine = lines.find((line) => /자동\s*갱신/.test(line));
      if (matchingLine) {
        fields.push({
          fieldKey: "autoRenewal",
          rawValue: matchingLine.trim(),
          normalizedValue: { value: true },
          confidence: DEV_EXTRACTOR_CONFIDENCE,
          sourceText: truncateSourceText(matchingLine.trim()),
        });
      }
    }

    return { fields, warnings };
  }
}
