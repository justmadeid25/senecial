import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type { AppLogger } from "@/domain/logging/logger";
import { getLogger } from "@/server/logging";
import {
  LEGAL_PROVIDER_ERROR_CODES,
  LegalProviderError,
  normalizeLegalProviderError,
  type LawOpenDataProvider,
  type LegalProviderErrorCode,
  type PrecedentSearchFilters,
} from "@/domain/legal";

import { isAuthorizedBearer } from "./legal-gateway-auth";
// TEMPORARY - Phase L1.4 diagnostic only, see that file's own docstring.
// REMOVE this import and the route below once the probe result is captured.
import { runMinimalRequestDiagnosticProbe } from "./minimal-request-diagnostic-probe";

export interface LegalGatewayServerDependencies {
  /** The real LawOpenDataHttpProvider in production; any LawOpenDataProvider (a fake, in tests) is accepted - see this file's own docstring. */
  provider: LawOpenDataProvider;
  sharedSecret: string;
  logger?: AppLogger;
  /** Legal search/fetch requests are tiny JSON payloads, never a file upload - default is generous headroom, not a file-sized limit. */
  maxBodyBytes?: number;
  /** Outer safety-net timeout wrapping each provider call - see withOuterTimeout()'s own docstring below for why this must stay well above the provider's own worst-case retry duration. */
  requestTimeoutMs?: number;
  maxQueryLength?: number;
  maxLimit?: number;
}

const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_QUERY_LENGTH = 300;
const DEFAULT_MAX_LIMIT = 50;
/** law.go.kr official IDs (법령ID/법령일련번호/판례일련번호) are plain digits/letters in practice; this whitelist is the route-traversal/arbitrary-path defense for §12 - never widened to accept `/`, `.`, or other path-meaningful characters. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const PROVIDER_NAME = "legal-gateway";

/**
 * Deliberately does NOT `req.destroy()` on an oversized body (unlike
 * scripts/malware-scanner-server.ts's identical-looking helper) - req/res
 * share one socket for HTTP/1.1, so destroying the request here would also
 * kill the response before the 413 envelope below can ever be written,
 * turning a clean rejection into a broken connection. Instead this just
 * stops accumulating and pauses the stream; the request handler responds
 * normally and sets `Connection: close` so the socket (and any unread
 * trailing bytes) is discarded only after the response is flushed.
 */
function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        rejected = true;
        req.pause();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!rejected) reject(err);
    });
  });
}

interface ErrorEnvelope {
  ok: false;
  error: { code: LegalProviderErrorCode; message: string };
}
interface SuccessEnvelope<T> {
  ok: true;
  result: T;
}

function sendJson(res: ServerResponse, status: number, body: unknown, options?: { closeConnection?: boolean }): void {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.closeConnection) {
    headers.Connection = "close";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

/** `error.message` is always the FIXED safe string from LegalProviderError's own table (see legal-provider-error.ts) - never raw upstream text, never the request URL, never OC. */
function sendError(res: ServerResponse, status: number, error: LegalProviderError, options?: { closeConnection?: boolean }): void {
  const envelope: ErrorEnvelope = { ok: false, error: { code: error.errorCode, message: error.message } };
  sendJson(res, status, envelope, options);
}

function sendSuccess<T>(res: ServerResponse, result: T): void {
  const envelope: SuccessEnvelope<T> = { ok: true, result };
  sendJson(res, 200, envelope);
}

/**
 * Code -> HTTP status, purely for transport-level observability (curl/logs/
 * monitoring) - the gateway CLIENT (law-open-data-gateway-client-provider.ts)
 * never relies on this table; it treats the `ok:false` body's `error.code`
 * as authoritative and only falls back to status-based classification when
 * the body isn't a recognizable envelope at all. Not a reuse of
 * classifyLegalProviderHttpStatus() - that is the other direction
 * (status -> code) and is lossy (several statuses collapse to the same
 * code), so it cannot simply be inverted.
 */
function statusForErrorCode(code: LegalProviderErrorCode): number {
  switch (code) {
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_AUTH_FAILED:
      return 401;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_RATE_LIMITED:
      return 429;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_TIMEOUT:
      return 504;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST:
      return 400;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNAVAILABLE:
      return 503;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE:
      return 502;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_ABORTED:
      return 408;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_SOURCE_NOT_FOUND:
      return 404;
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_SOURCE_UNVERIFIED:
      return 422;
    default:
      return 500;
  }
}

function validationError(): LegalProviderError {
  return new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST, providerName: PROVIDER_NAME });
}
function authError(): LegalProviderError {
  return new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_AUTH_FAILED, providerName: PROVIDER_NAME });
}
function timeoutError(): LegalProviderError {
  return new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_TIMEOUT, providerName: PROVIDER_NAME });
}

function parseLimit(raw: unknown, maxLimit: number): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > maxLimit) {
    throw validationError();
  }
  return raw;
}

function parseQuery(raw: unknown, maxQueryLength: number): string {
  if (typeof raw !== "string") throw validationError();
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxQueryLength) throw validationError();
  return trimmed;
}

function parseOptionalString(raw: unknown, maxLength: number): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maxLength) throw validationError();
  return raw;
}

function parsePrecedentFilters(raw: unknown): PrecedentSearchFilters | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw validationError();
  const record = raw as Record<string, unknown>;
  const allowedKeys = new Set(["courtName", "decisionDateFrom", "decisionDateTo"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw validationError();
  }
  const filters: PrecedentSearchFilters = {};
  const courtName = parseOptionalString(record.courtName, 50);
  if (courtName !== undefined) filters.courtName = courtName;
  const decisionDateFrom = parseOptionalString(record.decisionDateFrom, 20);
  if (decisionDateFrom !== undefined) filters.decisionDateFrom = decisionDateFrom;
  const decisionDateTo = parseOptionalString(record.decisionDateTo, 20);
  if (decisionDateTo !== undefined) filters.decisionDateTo = decisionDateTo;
  return filters;
}

function parseJsonBody(buffer: Buffer): unknown {
  if (buffer.length === 0) return {};
  let text: string;
  try {
    text = buffer.toString("utf8");
  } catch {
    throw validationError();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw validationError();
  }
}

/** Decodes and whitelists a path segment against ID_PATTERN - the route-traversal/arbitrary-path rejection required by §12. Never used to touch the filesystem or forwarded as a URL fragment to anything but LawOpenDataProvider's own typed methods. */
function extractId(pathSegment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathSegment);
  } catch {
    throw validationError();
  }
  if (!ID_PATTERN.test(decoded)) throw validationError();
  return decoded;
}

/**
 * Wraps a provider call with the gateway's OWN outer AbortController/
 * timeout - a safety net above LawOpenDataHttpProvider's own timeout/
 * retry/circuit-breaker (execute-legal-provider-with-resilience.ts), never
 * a second retry loop (§4 "Avoid retry-at-two-layers behavior"). Must stay
 * comfortably above the provider's own worst-case retry duration (default
 * policy: up to 3 attempts * 15s timeout + backoff <~60s) so this never
 * fires ahead of a legitimate in-flight retry - the 60s default reflects
 * that, not an arbitrary round number.
 */
async function withOuterTimeout<T>(requestTimeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

interface RouteContext {
  res: ServerResponse;
  body: unknown;
  pathParam?: string;
}
type RouteHandler = (ctx: RouteContext) => Promise<void>;

interface MatchedRoute {
  key: string;
  pathParam?: string;
}

/**
 * §Phase L1.3 - the Legal Gateway's request-handling core, factored out
 * from process bootstrap (PORT/env/signal handling lives in
 * scripts/legal-gateway-server.ts) so tests can inject a fake
 * LawOpenDataProvider and never need a real LAW_OPEN_DATA_OC or network
 * access.
 *
 * Exposes exactly 5 routes - GET /health plus one POST route per
 * LawOpenDataProvider method - never a generic proxy: no request accepts a
 * caller-supplied url/host/hostname/protocol/pathname to forward anywhere.
 * Every /legal/* route requires a valid
 * `Authorization: Bearer <sharedSecret>` header (constant-time compare,
 * see legal-gateway-auth.ts); /health does not (matches
 * scripts/malware-scanner-server.ts's own convention) and never touches
 * `deps.provider`.
 */
export function createLegalGatewayServer(deps: LegalGatewayServerDependencies): Server {
  const logger = deps.logger ?? getLogger();
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxQueryLength = deps.maxQueryLength ?? DEFAULT_MAX_QUERY_LENGTH;
  const maxLimit = deps.maxLimit ?? DEFAULT_MAX_LIMIT;

  const routes: Record<string, RouteHandler> = {
    "POST /legal/statutes/search": async ({ res, body }) => {
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw validationError();
      const record = body as Record<string, unknown>;
      const query = parseQuery(record.query, maxQueryLength);
      const limit = parseLimit(record.limit, maxLimit);
      const result = await withOuterTimeout(requestTimeoutMs, (signal) =>
        deps.provider.searchStatutes(query, { limit, abortSignal: signal })
      );
      sendSuccess(res, result);
    },
    "POST /legal/statutes/:id": async ({ res, pathParam }) => {
      const officialLawId = extractId(pathParam!);
      const result = await withOuterTimeout(requestTimeoutMs, (signal) =>
        deps.provider.fetchStatuteBody(officialLawId, { abortSignal: signal })
      );
      sendSuccess(res, result);
    },
    "POST /legal/precedents/search": async ({ res, body }) => {
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw validationError();
      const record = body as Record<string, unknown>;
      const query = parseQuery(record.query, maxQueryLength);
      const filters = parsePrecedentFilters(record.filters);
      const limit = parseLimit(record.limit, maxLimit);
      const result = await withOuterTimeout(requestTimeoutMs, (signal) =>
        deps.provider.searchPrecedents(query, filters, { limit, abortSignal: signal })
      );
      sendSuccess(res, result);
    },
    "POST /legal/precedents/:id": async ({ res, pathParam }) => {
      const officialPrecedentId = extractId(pathParam!);
      const result = await withOuterTimeout(requestTimeoutMs, (signal) =>
        deps.provider.fetchPrecedentBody(officialPrecedentId, { abortSignal: signal })
      );
      sendSuccess(res, result);
    },
    // TEMPORARY - Phase L1.4 diagnostic only (see minimal-request-diagnostic-probe.ts).
    // No caller-supplied params - a fixed, hardcoded, single-purpose probe.
    // REMOVE once the probe result is captured.
    "POST /diagnostics/minimal-request-probe": async ({ res }) => {
      const result = await runMinimalRequestDiagnosticProbe();
      sendJson(res, 200, { ok: true, result });
    },
  };

  function matchRoute(method: string, url: string): MatchedRoute | undefined {
    const path = url.split("?")[0] ?? "";
    const staticKey = `${method} ${path}`;
    if (routes[staticKey]) return { key: staticKey };

    const segments = path.split("/").filter(Boolean);
    if (method === "POST" && segments.length === 3 && segments[0] === "legal") {
      if (segments[1] === "statutes" && segments[2] !== "search") {
        return { key: "POST /legal/statutes/:id", pathParam: segments[2] };
      }
      if (segments[1] === "precedents" && segments[2] !== "search") {
        return { key: "POST /legal/precedents/:id", pathParam: segments[2] };
      }
    }
    return undefined;
  }

  const server = createServer((req, res) => {
    const requestId = randomUUID();
    const method = req.method ?? "";
    const url = req.url ?? "";

    if (method === "GET" && url === "/health") {
      sendJson(res, 200, { status: "ok", service: "legal-gateway" });
      return;
    }

    const matched = matchRoute(method, url);
    if (!matched) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    // Never logs req.headers.authorization itself - only the boolean outcome.
    if (!isAuthorizedBearer(req.headers.authorization, deps.sharedSecret)) {
      logger.warn("legal_gateway.unauthorized", { requestId, route: matched.key });
      sendError(res, 401, authError());
      return;
    }

    const start = Date.now();
    readBody(req, maxBodyBytes)
      .then((buffer) => parseJsonBody(buffer))
      .then((body) => routes[matched.key]!({ res, body, pathParam: matched.pathParam }))
      .then(() => {
        logger.info("legal_gateway.request_succeeded", { requestId, route: matched.key, durationMs: Date.now() - start });
      })
      .catch((rawError: unknown) => {
        const message = rawError instanceof Error ? rawError.message : String(rawError);
        if (message === "PAYLOAD_TOO_LARGE") {
          logger.warn("legal_gateway.payload_too_large", { requestId, route: matched.key });
          sendError(res, 413, validationError(), { closeConnection: true });
          return;
        }
        const error = normalizeLegalProviderError({ error: rawError, providerName: PROVIDER_NAME });
        logger.warn("legal_gateway.request_failed", {
          requestId,
          route: matched.key,
          errorCode: error.errorCode,
          durationMs: Date.now() - start,
        });
        sendError(res, statusForErrorCode(error.errorCode), error);
      });
  });

  return server;
}
