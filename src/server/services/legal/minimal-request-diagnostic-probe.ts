/**
 * TEMPORARY - Phase L1.4 diagnostic only. Tests whether dropping
 * query/display/page (matching the exact minimal request shape the law.go.kr
 * portal's own logged-in self-diagnostic reportedly used successfully with
 * this OC) changes the user/IP/domain verification outcome that every
 * prior live probe in this phase has returned. Bypasses
 * LawOpenDataHttpProvider entirely (that class hard-requires a non-empty
 * `query` and always sends `display` - not modified for this) - this is a
 * standalone, minimal, HARDCODED single-purpose probe:
 * target=law, type=json, and NOTHING else besides OC. No caller-supplied
 * parameters of any kind - this must never become a general client.
 *
 * Reads LAW_OPEN_DATA_OC directly from the gateway's own existing runtime
 * environment (the same value LawOpenDataHttpProvider already uses) -
 * introduces no new credential.
 *
 * Never returns: OC, the request URL (which embeds OC as a query
 * parameter), headers, or the raw response body. Only: HTTP status,
 * content-type, top-level JSON key names, a small set of known-safe
 * candidate status/count field values (result/msg/resultCode/resultMsg/
 * totalCnt), and array-field lengths (to confirm a real result list came
 * back without dumping its content).
 *
 * REMOVE THIS FILE AND ITS ROUTE ONCE THE PROBE RESULT HAS BEEN CAPTURED.
 */

const DIAGNOSTIC_MAX_FIELD_LENGTH = 300;
const REDACTED_PLACEHOLDER = "[REDACTED]";
const PROBE_TIMEOUT_MS = 15_000;

/** Same sanitization discipline as the other L1.4 diagnostic probes - intentionally a separate small copy, not imported, so this throwaway file has zero coupling to production code and can be deleted in one step. */
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

export interface MinimalRequestDiagnosticResult {
  httpStatus: number;
  contentType: string | null;
  topLevelKeys: string[];
  candidateFields: Record<string, string>;
  arrayFieldLengths: Record<string, number>;
}

const CANDIDATE_KEYS = ["result", "msg", "resultCode", "resultMsg", "totalCnt"];

export async function runMinimalRequestDiagnosticProbe(): Promise<MinimalRequestDiagnosticResult> {
  const oc = process.env.LAW_OPEN_DATA_OC;
  if (!oc) {
    throw new Error("LAW_OPEN_DATA_OC이 설정되지 않았습니다.");
  }

  const url = new URL("https://www.law.go.kr/DRF/lawSearch.do");
  url.searchParams.set("OC", oc);
  url.searchParams.set("target", "law");
  url.searchParams.set("type", "json");
  // Deliberately NO query, display, or page - matches the exact minimal
  // shape reported as successful in the portal's own self-diagnostic.

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

  let topLevelKeys: string[] = [];
  const candidateFields: Record<string, string> = {};
  const arrayFieldLengths: Record<string, number> = {};

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      topLevelKeys = Object.keys(record);

      for (const key of CANDIDATE_KEYS) {
        const value = record[key];
        if (typeof value === "string") {
          candidateFields[key] = sanitize(value);
        } else if (typeof value === "number") {
          candidateFields[key] = String(value);
        }
      }

      for (const [key, value] of Object.entries(record)) {
        if (Array.isArray(value)) {
          arrayFieldLengths[key] = value.length;
        } else if (value && typeof value === "object") {
          for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            if (Array.isArray(nestedValue)) {
              arrayFieldLengths[`${key}.${nestedKey}`] = nestedValue.length;
            }
          }
        }
      }
    }
  } catch {
    // Non-JSON or malformed body - leave the structural fields empty;
    // httpStatus/contentType alone still carry signal.
  }

  return { httpStatus: response.status, contentType, topLevelKeys, candidateFields, arrayFieldLengths };
}
