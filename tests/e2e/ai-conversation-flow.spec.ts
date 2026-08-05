import { execFileSync } from "node:child_process";

import { Document, Packer, Paragraph } from "docx";
import { expect, test } from "@playwright/test";

import { cardByHeading } from "./helpers/scoping";

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
    await expect(cardByHeading(page, "첨부 파일").getByText("ai-e2e-source.docx")).toBeVisible({ timeout: 120_000 });

    const fileRow = page.getByRole("row").filter({ hasText: "ai-e2e-source.docx" });
    await fileRow.getByRole("button", { name: "정보 추출" }).click();
    await expect(page.getByText("정보 추출을 시작했습니다.")).toBeVisible();
    runWorker("scripts/process-extraction-jobs.ts");

    await page.goto(contractUrl);
    await expect(page.getByText("계약 조항 분해")).toBeVisible();
    await page.getByRole("button", { name: "조항 분해 시작" }).click();
    await expect(page.getByText("조항 분해를 시작했습니다.")).toBeVisible();
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
