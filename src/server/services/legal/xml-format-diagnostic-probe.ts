/**
 * TEMPORARY - Phase L1.4 diagnostic only. Tests whether law.go.kr's
 * `type=XML` response format changes the user/IP/domain verification
 * outcome that `type=JSON` has been returning throughout L1.4's live
 * verification. Bypasses LawOpenDataHttpProvider entirely (that class is
 * JSON-only by design and is NOT modified for this) - this is a
 * standalone, minimal, HARDCODED single-purpose probe: target=law,
 * query=민법, display=5, type=XML. No caller-supplied parameters of any
 * kind - this must never become a general XML client or accept arbitrary
 * input.
 *
 * Reads LAW_OPEN_DATA_OC directly from the gateway's own existing runtime
 * environment (the same value LawOpenDataHttpProvider already uses) -
 * introduces no new credential.
 *
 * Never returns: OC, the request URL (which embeds OC as a query
 * parameter), headers, or the raw XML body. Only short,
 * sanitized/redacted/truncated candidate result/msg-like tag contents (or
 * a short sanitized fallback snippet if no known tag is found).
 *
 * REMOVE THIS FILE AND ITS ROUTE ONCE THE PROBE RESULT HAS BEEN CAPTURED -
 * see docs/operations/legal-intelligence.md's Manual probe section.
 */

const DIAGNOSTIC_MAX_FIELD_LENGTH = 300;
const REDACTED_PLACEHOLDER = "[REDACTED]";
const PROBE_TIMEOUT_MS = 15_000;

/** Same sanitization discipline as law-open-data-http-provider.ts's sanitizeUpstreamDiagnosticField() - intentionally a separate small copy (not imported), so this throwaway file has zero coupling to production provider code and can be deleted in one step. */
function sanitize(value: string): string {
  const withoutControlChars = value.replace(/[\r\n\t\x00-\x1F\x7F]/g, " ");
  const withoutEmails = withoutControlChars.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    REDACTED_PLACEHOLDER
  );
  const withoutLongTokens = withoutEmails.replace(/[A-Za-z0-9_-]{16,}/g, REDACTED_PLACEHOLDER);
  return withoutLongTokens.length > DIAGNOSTIC_MAX_FIELD_LENGTH
    ? `${withoutLongTokens.slice(0, DIAGNOSTIC_MAX_FIELD_LENGTH)}…`
    : withoutLongTokens;
}

function extractTag(xml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i").exec(xml);
  return match?.[1]?.trim();
}

export interface XmlFormatDiagnosticResult {
  httpStatus: number;
  contentType: string | null;
  candidateFields: Record<string, string>;
  snippetFallback?: string;
}

const CANDIDATE_TAGS = ["result", "msg", "message", "errMsg", "returnAuthMsg", "returnReasonCode", "error"];

export async function runXmlFormatDiagnosticProbe(): Promise<XmlFormatDiagnosticResult> {
  const oc = process.env.LAW_OPEN_DATA_OC;
  if (!oc) {
    throw new Error("LAW_OPEN_DATA_OC이 설정되지 않았습니다.");
  }

  const url = new URL("https://www.law.go.kr/DRF/lawSearch.do");
  url.searchParams.set("OC", oc);
  url.searchParams.set("type", "XML");
  url.searchParams.set("target", "law");
  url.searchParams.set("query", "민법");
  url.searchParams.set("display", "5");

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(timeoutHandle);
  }

  const contentType = response.headers.get("content-type");
  const text = await response.text();

  const candidateFields: Record<string, string> = {};
  for (const tag of CANDIDATE_TAGS) {
    const value = extractTag(text, tag);
    if (value) {
      candidateFields[tag] = sanitize(value);
    }
  }

  const result: XmlFormatDiagnosticResult = {
    httpStatus: response.status,
    contentType,
    candidateFields,
  };
  if (Object.keys(candidateFields).length === 0) {
    result.snippetFallback = sanitize(text.slice(0, DIAGNOSTIC_MAX_FIELD_LENGTH));
  }
  return result;
}
