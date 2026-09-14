# Legal Intelligence Platform (Phase L1 - Official Legal Evidence Foundation)

## 아키텍처 개요

Phase L1 integrates 대한민국 국가법령정보 공동활용 (Law Open Data) as the
platform's first and only Tier A (authoritative) legal source, alongside the
existing contract-scoped AI (see [ai-platform.md](./ai-platform.md)). It is a
deliberately narrow phase - **no full Korean legal database is built.**

```
query / contract issue
  -> Law Open Data search        (features/legal/server/search-statutes.ts,
                                   search-precedents.ts)
  -> official source result      (domain/legal/law-open-data-provider.ts
                                   DTOs - never the raw Korean API JSON)
  -> official body fetch         (LawOpenDataProvider.fetchStatuteBody /
                                   fetchPrecedentBody)
  -> normalization                (domain/legal/normalize-statute.ts,
                                    normalize-precedent.ts)
  -> verification                 (domain/legal/legal-source-verification.ts)
  -> cached LegalEvidence          (Prisma: LegalSource / LegalSourceFragment)
  -> (future) Legal RAG / citation integration
```

This mirrors the existing AI subsystem's layering exactly:
`domain/legal` (pure, provider-agnostic) -> `server/services/legal`
(provider implementations + resilience) -> `features/legal/server`
(orchestration: the lazy cache). No file outside `domain/legal` /
`server/services/legal` ever sees the Law Open Data API's raw Korean JSON
field names (`법령명한글`, `조문내용`, ...) - see
`law-open-data-http-provider.ts`'s own docstring.

## 출처 신뢰도 계층 (Source-of-Truth Hierarchy)

**Tier A - VERIFIED / authoritative** (may become `verificationStatus =
VERIFIED_OFFICIAL`):

- Official statute text fetched from 국가법령정보 공동활용 (`LawOpenDataProvider.fetchStatuteBody`)
- Official precedent text fetched from the same API (`fetchPrecedentBody`)
- (Scaffolded, not implemented) 법령해석례 fetched from the same API
- The user's own contract documents (already covered by the existing
  contract-scoped AI - unrelated to this module)

**Tier C - discovery only, NOT implemented in this phase:**

- Perplexity / general web search
- Law firm articles, blogs, news

**No secondary web result may become VERIFIED legal evidence in this
phase.** Perplexity is not called anywhere in this codebase as of Phase L1.
A future phase may add a Tier C discovery layer whose results are only ever
a *lead* to resolve against the Tier A path above - a web/discovery result
is never itself citable evidence. **Web/discovery results are not
authoritative legal evidence until resolved against an approved official
source.**

## VERIFIED vs. UNVERIFIED

A `LegalSource` row's `verificationStatus` is decided ENTIRELY by
`domain/legal/legal-source-verification.ts`'s `verifyLegalSource()` -
deterministic, never LLM-influenced:

- `authority` must be `LAW_OPEN_DATA`
- the official external ID must be present
- the official body-fetch call must have actually succeeded (a search-result
  snippet alone is never sufficient - see §Critical below)
- content must be non-empty and hash successfully
- source-type-specific required metadata must resolve (a statute needs a
  `lawName`; a precedent needs a `court`)

**Critical (precedents):** a search hit (`PrecedentSearchHit`) can never by
itself produce a `VERIFIED_OFFICIAL` row. Only `getOrFetchPrecedent()` -
which always calls `fetchPrecedentBody()` first - can. The LLM (when a
future phase wires this into an AI answer) never invents or reformats a
`caseNumber`; it is copied byte-for-byte from the official API response
(`normalize-precedent.ts`).

Any consumer deciding eligibility for grounding/citation MUST use
`isVerifiedOfficial()` - never a raw string comparison against the enum.

## Identity (never display text)

A `LegalSource`'s identity is `authority + sourceType + externalId [+
articleId]` (`buildLegalSourceIdentityKey()`) - never `title`/
`citationLabel`/`lawName`/`caseNumber`, which are display text that may
legitimately be reformatted without changing the underlying provision (the
exact bug class `domain/ai/citation-provision.ts` already fixed for
contract-clause citations).

## Statute article-level design

A statute body-fetch response is split into one `LegalSourceFragment` per
official article (`normalize-statute.ts`'s `buildStatuteFragments()`), so a
future pinpoint citation like 민법 제398조 제2항 can address a specific
article without re-fetching/re-splitting the whole law. This phase stops at
**article** granularity; narrowing further to a specific 항/호 is the future
Pinpointer's job (see below).

## Lazy cache (durable, Postgres-backed)

`LegalSource`/`LegalSourceFragment` (Prisma) is the durable cache - **no
Redis dependency for verified legal evidence**, matching the phase's
"prefer durable DB cache" guidance (official legal text changes on the
order of months, not something worth an ephemeral cache's volatility).

- `LEGAL_STATUTE_CACHE_TTL_SECONDS` (default 30 days) /
  `LEGAL_PRECEDENT_CACHE_TTL_SECONDS` (default 180 days) - see
  `lib/config/legal.ts`.
- `features/legal/server/get-or-fetch-statute.ts` /
  `get-or-fetch-precedent.ts`: cache hit within TTL returns the stored row
  with **zero** provider/network call; a miss or stale row triggers a
  refetch -> normalize -> verify -> upsert. A refetch that itself fails
  still returns the stale row rather than surfacing the error (cache
  staleness is a performance concern, never a hard failure - matches
  `lib/config/ai-cache.ts`'s identical philosophy).
- `revision` (on `LegalSource`) increments only when a refetch's
  `contentHash` actually differs from what was stored - an unchanged
  refetch just refreshes `retrievedAt`.
- No bulk ingest: rows are created strictly on demand, one per distinct
  (statute article) or (precedent) actually looked up.

An `UNVERIFIED` row IS still cached (to avoid repeatedly re-fetching a
known-bad response) but MUST NOT be treated as authoritative by any
consumer - see `isVerifiedOfficial()`.

## Credential handling

- Environment variable: `LAW_OPEN_DATA_OC` - the OC identifier issued by
  law.go.kr's Open API registration.
- **Never logged, never committed.** Every log line in
  `execute-legal-provider-with-resilience.ts` / the HTTP provider carries
  only safe fields (`providerName`, `operation`, `errorCode`, `latencyMs`,
  `attempt`, `requestId`) - never the OC value, never a raw request URL
  (which embeds it as a query parameter), never a raw response body.
- `LAW_OPEN_DATA_PROVIDER=development` (the default) needs no credential at
  all and never touches the network - see
  `deterministic-development-law-open-data-provider.ts`. It is refused in
  production unless `ALLOW_DEVELOPMENT_LEGAL_PROVIDER=true` is explicitly
  set, mirroring every other `development` driver in this codebase.
- `NODE_ENV=test` hard-blocks any real Law Open Data network call
  regardless of driver/credential (`legal-provider-call-guard.ts`) unless a
  test explicitly sets `TEST_REAL_LEGAL_PROVIDER=true` - no test in this
  repository does, by design (§Testing below).
- `LAW_OPEN_DATA_PROVIDER=gateway` (Phase L1.3, see §Legal Gateway
  architecture below) never reads `LAW_OPEN_DATA_OC` at all - it reads
  `LEGAL_GATEWAY_URL`/`LEGAL_GATEWAY_SHARED_SECRET` instead
  (`src/lib/config/legal-gateway.ts`) and relays every call to the Legal
  Gateway service, which is the only process meant to ever hold the real
  OC in production.

## Legal Gateway architecture (Phase L1.2/L1.3)

L1.1's live retry (see §Manual probe below) confirmed the blocker is
network identity, not the request contract or the OC itself: law.go.kr
rejects calls with `사용자 정보 검증에 실패하였습니다.` / "register the exact
server IP address and domain" until the calling server's IP is registered
on the portal. Local/Vercel egress IPs are not stable, so no amount of
request-shape fixing resolves this - the fix is infrastructure, not code.

**Target architecture (designed in L1.2, scaffolded in code in L1.3 -
NOT YET PROVISIONED OR WIRED):**

```
Vercel (Next.js app)
   │  HTTPS, Authorization: Bearer <LEGAL_GATEWAY_SHARED_SECRET>
   ▼
Legal Gateway - dedicated Railway service (Dockerfile.legal-gateway /
scripts/legal-gateway-server.ts), the ONLY process that holds
LAW_OPEN_DATA_OC and calls law.go.kr directly
   │  Static Outbound IP (Railway service-level setting)
   ▼
law.go.kr (국가법령정보 공동활용 OPEN API)
```

Chosen over reusing the existing worker service (Dockerfile.worker)
because Static Outbound IP is a whole-**service** setting on Railway -
enabling it on the worker would make every one of the worker's *other*
outbound calls (OpenAI, Perplexity, R2, Postmark, Neon) static too, an
unrelated blast-radius increase. A dedicated service also matches this
repo's own existing precedent: `senecial-scanner`
(`Dockerfile.scanner` / `scripts/malware-scanner-server.ts` /
`clamav-http-file-malware-scanner.ts`) already solves the identical shape
of problem (Vercel needs a capability that can't/shouldn't live in the
Vercel runtime) the same way - a small dedicated Railway service reached
over public HTTPS with a shared bearer secret. The Legal Gateway mirrors
that pattern directly rather than inventing a new one.

**Credential/secret placement (production, once provisioned):**

| Variable | Lives on |
|---|---|
| `LAW_OPEN_DATA_OC` | **Legal Gateway only.** Never on Vercel. |
| `LEGAL_GATEWAY_SHARED_SECRET` | Legal Gateway **and** Vercel (same value). |
| `LEGAL_GATEWAY_URL` | Vercel only (the gateway's public HTTPS URL). |

**API surface** - `createLegalGatewayServer()`
(`src/server/services/legal/legal-gateway-server.ts`) exposes exactly:

- `GET /health` - unauthenticated, cheap, never calls law.go.kr.
- `POST /legal/statutes/search`
- `POST /legal/statutes/:id`
- `POST /legal/precedents/search`
- `POST /legal/precedents/:id`

One typed route per `LawOpenDataProvider` method - **never** a generic
`GET /proxy?url=...` or any route that accepts a caller-supplied
url/host/hostname/protocol/pathname to forward. Every `/legal/*` route
requires the bearer secret (constant-time compare,
`legal-gateway-auth.ts`); a wrong/missing/malformed secret always gets the
same generic `LEGAL_PROVIDER_AUTH_FAILED` envelope - it never reveals
which check failed. The gateway does **no** parsing/normalization of its
own: server-side it just runs the existing `LawOpenDataHttpProvider`
and relays its typed result as JSON; client-side
(`law-open-data-gateway-client-provider.ts`, a new
`LawOpenDataProvider` implementation selected via
`LAW_OPEN_DATA_PROVIDER=gateway`) just decodes that envelope and
reconstructs the same closed `LegalProviderErrorCode` vocabulary - see
§Error model. This keeps exactly one place (the existing HTTP provider)
owning the raw-Korean-field -> DTO mapping.

**Current status - explicitly NOT done yet:**

- Static Outbound IP is **not enabled** on any Railway service (confirmed
  via `railway outbound-network static-ip status` during the L1.2 audit -
  `enabled: false` on both existing services).
- The Legal Gateway Railway service itself has **not been created**.
- No IP/domain has been registered on the law.go.kr portal for this
  purpose.
- `LAW_OPEN_DATA_PROVIDER` is **not** set to `gateway` anywhere in
  production - the existing `development`/`http` defaults are untouched.
- Live law.go.kr verification remains **blocked** until the above is
  provisioned and the resulting static IP is registered and propagates.

**Rollout sequence (documented, not executed by this phase):**

1. Create the Railway service from `Dockerfile.legal-gateway`; set
   `LAW_OPEN_DATA_OC` + `LEGAL_GATEWAY_SHARED_SECRET` there only.
2. Deploy; verify `GET /health`.
3. Enable Static Outbound IP on that service only (non-HA, i.e. a single
   IP - keeps the law.go.kr registration surface minimal); redeploy
   (Railway requires a redeploy for the IP change to take outbound
   effect).
4. Read back the assigned IP via `railway outbound-network static-ip
   status --json`.
5. Register that IP + the approved domain on the 국가법령정보 공동활용
   portal; wait for approval/propagation.
6. Re-run the L1.1-style live probe **from inside the gateway's own
   environment** first, to isolate "is the IP whitelisted" from "does the
   gateway plumbing work."
7. Only then set `LEGAL_GATEWAY_URL` + `LEGAL_GATEWAY_SHARED_SECRET` on
   Vercel and switch `LAW_OPEN_DATA_PROVIDER=gateway` there.

## Error model

`domain/legal/legal-provider-error.ts` - a closed vocabulary
(`LEGAL_PROVIDER_AUTH_FAILED` / `_TIMEOUT` / `_RATE_LIMITED` /
`_UNAVAILABLE` / `_INVALID_REQUEST` / `_MALFORMED_RESPONSE` / `_ABORTED` /
`_UNKNOWN`, plus `LEGAL_SOURCE_NOT_FOUND` / `LEGAL_SOURCE_UNVERIFIED`),
entirely parallel to `domain/ai/provider-error.ts` and never shared with it
- this phase never modifies the existing AI provider error path.

## Testing

Every test in `tests/unit/law-open-data-http-provider.test.ts` and
`tests/integration/legal-source-cache.test.ts` runs against a mocked
`fetch` or the `development` driver - no test depends on live Law Open Data
API availability. `LAW_OPEN_DATA_OC` was not available in this session, so
no real (non-fixture) API probe was performed - see §Manual probe below.

## Manual probe (Phase L1.1 - attempted, blocked before completion)

A controlled, read-only live probe was attempted against the real API with
a real `LAW_OPEN_DATA_OC` (never logged/committed - read directly out of
`.env.local` by the probe script, line-parsed for that one key only; every
other call was made against the local docker test DB, never the production
Neon DB also present in that file).

**Result: the search call (probe A - `lawSearch.do?target=law`) returned
HTTP 200 with the API's own generic error envelope:**

```json
{ "result": "필수입력요소 검증에 실패하였습니다.", "msg": "필수 입력값이 존재하지 않습니다. 요청 URL을 확인해 주세요." }
```

A follow-up diagnostic call with a deliberately bogus OC produced a
**different**, access-specific message:

```json
{ "result": "사용자 정보 검증에 실패하였습니다.", "msg": "OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요." }
```

The two messages differing indicates the configured OC is a real,
recognized registration - but something about this call is still being
rejected before reaching the actual search logic. The most likely causes
(config/CLI accessible to a human, not this codebase) are:

1. The law.go.kr Open API 활용신청 (usage application) for this OC is still
   **pending manual approval** rather than active.
2. The account has a **registered-IP/domain restriction** and the calling
   server's IP is not on that list.

**Real finding acted on regardless of the blocker:** the old provider code
had a genuine bug this probe surfaced - because the error envelope's shape
(`{result, msg}`) has none of the expected success keys (`LawSearch`/
`법령`/`PrecSearch`/`PrecService`), every per-endpoint parser's
`asArray(body.X?.y)` silently evaluated to `[]`, turning ANY request-level
rejection into "zero results" rather than a surfaced error. Fixed in
`LawOpenDataHttpProvider`'s new `rejectIfErrorEnvelope()` check (runs
immediately after JSON parsing, before any per-endpoint field access) with
regression tests covering both message shapes.

Also incorporated (per this phase's brief, not yet live-confirmed):
Supreme Court filtering on `target=prec` uses `org=400201`, not a
court-name string param - `curt` was removed.

Probes B/C/D (statute body fetch, Supreme Court precedent search,
precedent body fetch) were **not attempted** - there is nothing useful to
fetch/normalize/verify against an error envelope, and continuing past a
request-level rejection would just be more of the same failure. This is an
account-access prerequisite for the OC's owner to resolve on the law.go.kr
portal, not a code defect - **do not attempt to work around it in code**
(e.g., by adding IP-spoofing headers or retrying against a different
endpoint shape) once encountered again.

The raw JSON field names modeled in `law-open-data-http-provider.ts`
(`법령명한글`, `조문단위`, `PrecService`, ...) remain based on the API's
publicly documented shape and **still have not been verified against a
real success response** - re-run the probe (a throwaway script following
the same safety pattern: read the OC from `.env.local` directly, never
load the rest of that file, target the local test DB only) once account
access is confirmed working, and reconcile any further drift found there.

## Future work

- **Legal Gateway provisioning (L1.2 design complete, L1.3 code complete,
  infrastructure not yet approved)**: create the Railway service, enable
  Static Outbound IP, register it on the law.go.kr portal, and switch
  production to `LAW_OPEN_DATA_PROVIDER=gateway` - see §Legal Gateway
  architecture above for the full rollout sequence. This is the
  prerequisite for ever completing the §Manual probe below.
- **L2 - Legal Pinpointer + Fact Checker**: `domain/legal/legal-pinpointer.ts`
  is scaffolded (typed interface only, no implementation) - narrows a
  VERIFIED `LegalSource`/fragment down to the specific 항/호 or judgment
  paragraph that actually answers a question.
- **Citation integration**: `domain/legal/legal-citation-adapter.ts`'s
  `toLegalCitationDisplay()` is ready to feed a future
  `domain/ai/citation.ts` union member (`LegalCitation`, alongside the
  existing `ClauseCitation`/`ChunkCitation`) - deliberately not wired into
  production AI answers in this phase.
- **법령해석례 (Interpretation)**: `LegalSourceType.INTERPRETATION` and
  `LegalAuthority`/`LegalVerificationStatus` already support it end-to-end
  in the schema; only the provider methods
  (`searchInterpretations`/`fetchInterpretationBody`) remain to be added.
- **Perplexity / web discovery (Tier C)**: intentionally out of scope for
  every phase until an explicit future phase defines how a Tier C lead gets
  resolved against Tier A before ever becoming citable.
