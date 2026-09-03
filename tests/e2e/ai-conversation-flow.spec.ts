import { execFileSync } from "node:child_process";

import { Document, Packer, Paragraph } from "docx";
import { expect, test } from "@playwright/test";

/**
 * Full Phase 12 pipeline E2E coverage: upload -> extraction worker ->
 * segmentation worker -> embedding worker -> /ai chat (real streaming,
 * real citation, real hallucination-guard fallback). Uses the
 * deterministic development embedding/LLM providers (the only ones
 * available without a real AI API key) - see
 * server/services/ai/deterministic-development-*.ts.
 */

const runId = Date.now();
const ownerEmail = `ai-e2e-owner-${runId}@e2e-test.local`;
const password = "Password123";
const contractTitle = `AI 상담 E2E 계약 ${runId}`;

const TERMINATION_TEXT = "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.";
const CONFIDENTIALITY_TEXT = "양 당사자는 본 계약과 관련하여 취득한 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.";

async function buildContractDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

function runWorker(scriptPath: string) {
  execFileSync(
    "pnpm",
    ["exec", "dotenv", "-e", ".env.e2e", "--", "tsx", scriptPath, "--", "--limit=20"],
    { cwd: process.cwd(), stdio: "pipe", shell: process.platform === "win32" }
  );
}

async function signUp(page: import("@playwright/test").Page) {
  await page.goto("/signup");
  await page.getByLabel("이름").fill("AI E2E Owner");
  await page.getByLabel("회사명").fill("AI E2E Co");
  await page.getByLabel("이메일").fill(ownerEmail);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "회원가입" }).click();
  await page.waitForURL(/\/login/);
}

async function logIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(ownerEmail);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/dashboard/);
}

let contractUrl = "";

test.describe.serial("AI conversation: real citation + hallucination-guard fallback", () => {
  // Phase 12.1 - this sandbox's dev DB now runs the pgvector-capable
  // PostgreSQL build (see docs/operations/ai-platform.md) and the app
  // itself grew substantially in this phase (new schema, providers, cache,
  // metrics) - Turbopack's on-demand compilation of a much larger route
  // set, combined with pre-existing DB latency variance, empirically pushed
  // this test's first-upload step past its old 60s/15s budget. Bumped
  // based on real measured runs (~1.3 min for the setup test), not a
  // guess.
  test.setTimeout(180_000);

  test("owner sets up a contract with segmented, embedded clauses", async ({ page }) => {
    await signUp(page);
    await logIn(page);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    contractUrl = new URL(page.url()).pathname;

    const docxBuffer = await buildContractDocxBuffer([
      "AI 상담 E2E 테스트 계약서",
      "제1조(계약 해지)",
      TERMINATION_TEXT,
      "제2조(비밀유지)",
      CONFIDENTIALITY_TEXT,
    ]);

    await page.goto(contractUrl);
    // §Phase 12.4 §2/§5 - waits for the page to settle (chunks/RSC payload
    // loaded, React hydrated) before interacting with the file input.
    // Without this, setInputFiles() can occasionally fire its change event
    // before hydration attaches the form's onChange handler, leaving the
    // "업로드" button permanently disabled (a real bug found this way -
    // Playwright's own click() retry already waits the full test timeout
    // and the button never recovers, so this is a genuine missed event,
    // not merely "needs a longer wait").
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#contract-file", {
      name: "ai-e2e-source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docxBuffer,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    // §Phase 12.4 §10/§11 - this is the FIRST real upload of the whole
    // production-like run (ai-conversation-flow runs first in QUEUE_SPECS
    // order, right after server startup) - measured cold-server latency,
    // not a hung request (see scripts/run-e2e-prod.ts's warm-up comment
    // for the pg_stat_activity/server-log evidence). Confirmed NOT
    // explained by other-process contention either: re-measured at 66s on
    // an otherwise-idle machine (other apps closed, ~1% CPU) after the
    // 60s bump and the GET-only server warm-up below still weren't enough
    // - the warm-up primes read routes, not the write path (storage
    // put()/Prisma insert/Redis rate-limit check) this step actually
    // exercises for the first time. 120s is a real measured-worst-case
    // budget, not a guess; test.setTimeout(180_000) above still leaves
    // headroom for the rest of this test after it.
    //
    // §Investigation (2026-09) - was `cardByHeading(page, "첨부
    // 파일").getByText(filename)`, which is a FALSE-POSITIVE-PRONE
    // assertion: ContractFileUploadForm and ContractFileList share the
    // same "첨부 파일" Card (see contracts/[id]/page.tsx), and the upload
    // form's own client-side `fileName` state renders the selected
    // filename as soon as a file is picked - and stays rendered after a
    // FAILED submit (handleSubmit only calls setFileName(null) on
    // success) - so that assertion could pass even when the server-side
    // upload genuinely failed. ContractFileList renders a real <table>
    // only when `files.length > 0` (a plain <p> otherwise, and the
    // upload form never renders a table at all), so scoping to the table
    // role is an unambiguous signal that the file is actually attached,
    // not just locally selected.
    // .first() - Next dev-mode (Turbopack/React Strict Mode) can briefly
    // double-render this server-rendered table; the DB has exactly one
    // real ContractFile row (verified directly), so matching the first
    // occurrence is correct, not a workaround for a real duplicate.
    await expect(page.getByRole("table").getByText("ai-e2e-source.docx").first()).toBeVisible({ timeout: 120_000 });

    // §Phase 15.1 - upload auto-starts the extraction job - no click needed here.
    runWorker("scripts/process-extraction-jobs.ts");

    await page.goto(contractUrl);
    await expect(page.getByText("계약 조항 분해")).toBeVisible();
    // §Phase 15.1 - AutoStartSegmentationTrigger fires client-side on
    // mount and refreshes the page once the job is created - no manual
    // "조항 분해 시작" click needed.
    await expect(page.getByRole("button", { name: "조항 분해 시작" })).toHaveCount(0);
    await expect(page.getByText("대기 중")).toBeVisible();
    runWorker("scripts/process-clause-segmentation-jobs.ts");

    // §Embedding Pipeline - the segmentation worker's own completion hook
    // already enqueued an EmbeddingJob per clause (see
    // process-clause-segmentation-job.ts); this is the worker that
    // actually generates them.
    runWorker("scripts/process-embedding-jobs.ts");
  });

  test("asks a relevant question and receives a real streamed, cited answer", async ({ page }) => {
    await logIn(page);
    await page.goto("/ai");

    await page.getByPlaceholder("예: 이 계약의 해지 조건은 무엇인가요?").fill("계약을 해지하려면 어떻게 해야 하나요?");
    await page.getByRole("button", { name: "질문하기" }).click();

    // Scoped to the assistant's own message card (data-testid="ai-message-assistant")
    // rather than an unscoped page-wide text match - both the input's own
    // placeholder ("...해지 조건은...") and the echoed user question
    // (role="user" card, same "해지" substring) are real, separate matches
    // for "해지" elsewhere on this page, so an unscoped .first() could pass
    // without ever inspecting the actual AI answer.
    const assistantMessage = page.getByTestId("ai-message-assistant").last();
    await expect(assistantMessage).toContainText("해지", { timeout: 15_000 });
    await expect(assistantMessage).toContainText("근거", { timeout: 15_000 });
    await expect(assistantMessage).toContainText(contractTitle, { timeout: 15_000 });
  });

  test("asks an unrelated question and receives the fixed hallucination-guard fallback, never a guess", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/ai");

    await page
      .getByPlaceholder("예: 이 계약의 해지 조건은 무엇인가요?")
      .fill("오늘 서울 날씨는 어떤가요?");
    await page.getByRole("button", { name: "질문하기" }).click();

    await expect(page.getByTestId("ai-message-assistant").last()).toContainText("근거를 충분히 찾지 못했습니다", {
      timeout: 15_000,
    });
  });
});

const scopingOwnerEmail = `ai-e2e-scoping-owner-${runId}@e2e-test.local`;
const scopingContractTitle = `AI 상담 범위 지정 E2E 계약 ${runId}`;

async function signUpAs(
  page: import("@playwright/test").Page,
  params: { name: string; companyName: string; email: string }
) {
  await page.goto("/signup");
  await page.getByLabel("이름").fill(params.name);
  await page.getByLabel("회사명").fill(params.companyName);
  await page.getByLabel("이메일").fill(params.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "회원가입" }).click();
  await page.waitForURL(/\/login/);
}

async function logInAs(page: import("@playwright/test").Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/dashboard/);
}

let scopingContractUrl = "";

/**
 * §AI 상담 개편 - a fully self-contained fixture (its own owner/org/contract),
 * deliberately NOT sharing `contractUrl`/`ownerEmail` with the describe block
 * above: module-level state set inside one `test.describe` block was found
 * (empirically, via this test) to NOT reliably survive into a later
 * `test.describe` block in this Playwright setup, even under `workers: 1` /
 * `fullyParallel: false` - depending on it left every test below silently
 * running against an empty contractId. A dedicated fixture also means this
 * suite's own signal is never blocked by an unrelated failure earlier in the
 * file.
 *
 * Only the "sees the scoped banner and gets a citation" test lives here -
 * it needs the real upload/extraction/segmentation/embedding pipeline
 * below. The not-found tests (foreign org / invalid id) don't need any of
 * that (getContract() only checks existence/ownership, never file
 * content), so they live in their own, much cheaper describe block below
 * this one with a bare contract and no upload step.
 */
test.describe.serial("AI conversation: contract-scoped chat + tenant isolation (§AI 상담 개편)", () => {
  test.setTimeout(180_000);

  test("owner sets up a second, independent contract with segmented, embedded clauses (dedicated fixture for scoping tests)", async ({
    page,
  }) => {
    await signUpAs(page, { name: "AI E2E Scoping Owner", companyName: "AI E2E Scoping Co", email: scopingOwnerEmail });
    await logInAs(page, scopingOwnerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(scopingContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    scopingContractUrl = new URL(page.url()).pathname;

    const docxBuffer = await buildContractDocxBuffer([
      "AI 상담 범위 지정 E2E 테스트 계약서",
      "제1조(계약 해지)",
      TERMINATION_TEXT,
      "제2조(비밀유지)",
      CONFIDENTIALITY_TEXT,
    ]);

    await page.goto(scopingContractUrl);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#contract-file", {
      name: "ai-e2e-scoping-source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docxBuffer,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    // §Investigation (2026-09) - see the identical comment on the
    // describe block above for why this is scoped to the real file table
    // rather than the whole "첨부 파일" card.
    // .first() - see the identical comment on the describe block above.
    await expect(page.getByRole("table").getByText("ai-e2e-scoping-source.docx").first()).toBeVisible({
      timeout: 120_000,
    });

    runWorker("scripts/process-extraction-jobs.ts");

    await page.goto(scopingContractUrl);
    await expect(page.getByText("계약 조항 분해")).toBeVisible();
    await expect(page.getByRole("button", { name: "조항 분해 시작" })).toHaveCount(0);
    await expect(page.getByText("대기 중")).toBeVisible();
    runWorker("scripts/process-clause-segmentation-jobs.ts");
    runWorker("scripts/process-embedding-jobs.ts");
  });

  test("the owning organization's user hitting /ai?contractId=<its own contract id> sees the scoped banner and gets a citation restricted to it", async ({
    page,
  }) => {
    const contractId = scopingContractUrl.split("/").pop()!;
    expect(contractId.length).toBeGreaterThan(0);

    await logInAs(page, scopingOwnerEmail);
    const response = await page.goto(`/ai?contractId=${contractId}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("ai-scoped-contract-banner")).toContainText(scopingContractTitle);

    await page.getByPlaceholder("예: 이 계약의 해지 조건은 무엇인가요?").fill("계약을 해지하려면 어떻게 해야 하나요?");
    await page.getByRole("button", { name: "질문하기" }).click();

    const assistantMessage = page.getByTestId("ai-message-assistant").last();
    await expect(assistantMessage).toContainText("해지", { timeout: 15_000 });
    await expect(assistantMessage).toContainText(scopingContractTitle, { timeout: 15_000 });
  });

});

/**
 * §AI 상담 개편 - the not-found cases need only a real, existing contract
 * (getContract() checks existence/organization ownership - never file
 * content), so this fixture is deliberately just a bare
 * signup+contract-create with NO upload/extraction/segmentation step.
 * Kept separate from the describe block above so these two assertions get
 * a clean, independent signal that never depends on the upload/extraction
 * pipeline the citation test above needs.
 */
test.describe.serial("AI conversation: not-found handling for bad contractId (§AI 상담 개편)", () => {
  test.setTimeout(30_000);

  const notFoundOwnerEmail = `ai-e2e-notfound-owner-${runId}@e2e-test.local`;
  const notFoundOtherOwnerEmail = `ai-e2e-notfound-other-${runId}@e2e-test.local`;
  const notFoundContractTitle = `AI 상담 not-found E2E 계약 ${runId}`;
  let notFoundContractUrl = "";

  test("owner creates a bare contract (no file needed for these assertions)", async ({ page }) => {
    await signUpAs(page, {
      name: "AI E2E NotFound Owner",
      companyName: "AI E2E NotFound Co",
      email: notFoundOwnerEmail,
    });
    await logInAs(page, notFoundOwnerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(notFoundContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    notFoundContractUrl = new URL(page.url()).pathname;
  });

  test("a second organization's user hitting /ai?contractId=<first org's real contract id> gets not-found, never the scoped chat", async ({
    page,
  }) => {
    const contractId = notFoundContractUrl.split("/").pop()!;
    expect(contractId.length).toBeGreaterThan(0); // sanity - the fixture test above must have run first

    await signUpAs(page, {
      name: "AI E2E NotFound Other Owner",
      companyName: "AI E2E NotFound Other Co",
      email: notFoundOtherOwnerEmail,
    });
    await logInAs(page, notFoundOtherOwnerEmail);

    const response = await page.goto(`/ai?contractId=${contractId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("ai-scoped-contract-banner")).toHaveCount(0);
  });

  test("an invalid/non-existent contractId is also not-found, not a crash", async ({ page }) => {
    await logInAs(page, notFoundOwnerEmail);
    const response = await page.goto("/ai?contractId=nonexistent-id-does-not-exist");
    expect(response?.status()).toBe(404);
  });
});

const renewalOwnerEmail = `ai-e2e-renewal-owner-${runId}@e2e-test.local`;
const renewalContractTitle = `AI 상담 대화 맥락 E2E 계약 ${runId}`;
const RENEWAL_TEXT =
  "본 계약은 계약기간 종료 후 자동갱신되며, 종료 30일 전까지 서면으로 통지하지 않으면 동일한 조건으로 갱신된다.";
let renewalContractUrl = "";

/**
 * §AI 답변 품질 개편 P0-1 - real-browser proof that a follow-up question
 * with no legal keywords of its own ("그럼 언제까지 말해야 돼?") is
 * answered correctly once the bounded prior turn is folded into
 * retrieval/the prompt (see conversation-context.ts), AND that this still
 * stays correctly scoped to the SAME contract throughout (contractId
 * carried via `/ai?contractId=...`, re-verified server-side on every
 * request - see route.ts's Conversation.contractId check). Own dedicated
 * fixture, same rationale as the scoping describe block above (module
 * state does not reliably survive across `test.describe` blocks here).
 */
test.describe.serial("AI conversation: multi-turn context follows a contextless follow-up (§AI 답변 품질 개편 P0-1)", () => {
  test.setTimeout(180_000);

  test("owner sets up a contract with an auto-renewal/notice clause", async ({ page }) => {
    await signUpAs(page, { name: "AI E2E Renewal Owner", companyName: "AI E2E Renewal Co", email: renewalOwnerEmail });
    await logInAs(page, renewalOwnerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(renewalContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    renewalContractUrl = new URL(page.url()).pathname;

    const docxBuffer = await buildContractDocxBuffer([
      "AI 상담 대화 맥락 E2E 테스트 계약서",
      "제2조(계약기간)",
      RENEWAL_TEXT,
    ]);

    await page.goto(renewalContractUrl);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#contract-file", {
      name: "ai-e2e-renewal-source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docxBuffer,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    await expect(page.getByRole("table").getByText("ai-e2e-renewal-source.docx").first()).toBeVisible({
      timeout: 120_000,
    });

    runWorker("scripts/process-extraction-jobs.ts");

    await page.goto(renewalContractUrl);
    await expect(page.getByText("계약 조항 분해")).toBeVisible();
    await expect(page.getByRole("button", { name: "조항 분해 시작" })).toHaveCount(0);
    await expect(page.getByText("대기 중")).toBeVisible();
    runWorker("scripts/process-clause-segmentation-jobs.ts");
    runWorker("scripts/process-embedding-jobs.ts");
  });

  test("a contextless follow-up question is answered correctly using the immediately preceding turn, still scoped to the same contract", async ({
    page,
  }) => {
    const contractId = renewalContractUrl.split("/").pop()!;
    expect(contractId.length).toBeGreaterThan(0);

    await logInAs(page, renewalOwnerEmail);
    const response = await page.goto(`/ai?contractId=${contractId}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("ai-scoped-contract-banner")).toContainText(renewalContractTitle);

    // Question 1 - establishes the auto-renewal context.
    await page.getByPlaceholder("예: 이 계약의 해지 조건은 무엇인가요?").fill("이 계약 자동갱신돼?");
    await page.getByRole("button", { name: "질문하기" }).click();
    const firstAnswer = page.getByTestId("ai-message-assistant").last();
    await expect(firstAnswer).toContainText("갱신", { timeout: 15_000 });
    await expect(firstAnswer).toContainText("근거", { timeout: 15_000 });

    // Question 2 - a genuinely contextless follow-up: no "자동갱신"/"통지"/
    // "갱신" keyword of its own. Before P0-1, this had no way to resolve
    // "그럼" and would very likely fall through to the hallucination-guard
    // fallback ("근거를 충분히 찾지 못했습니다") despite the answer being
    // right there in the clause the FIRST question already surfaced.
    await page.getByPlaceholder("예: 이 계약의 해지 조건은 무엇인가요?").fill("그럼 언제까지 말해야 돼?");
    await page.getByRole("button", { name: "질문하기" }).click();
    const secondAnswer = page.getByTestId("ai-message-assistant").last();
    // Must NOT be the hallucination-guard fallback - the whole point of
    // this test is that history rescues an otherwise-unanswerable question.
    await expect(secondAnswer).not.toContainText("근거를 충분히 찾지 못했습니다", { timeout: 15_000 });
    await expect(secondAnswer).toContainText("30일", { timeout: 15_000 });
    await expect(secondAnswer).toContainText("근거", { timeout: 15_000 });
    // Still correctly scoped to the SAME contract throughout the
    // multi-turn exchange - no contract-scope leakage across turns.
    await expect(secondAnswer).toContainText(renewalContractTitle, { timeout: 15_000 });
    await expect(page.getByTestId("ai-scoped-contract-banner")).toContainText(renewalContractTitle);
  });
});
