import { execFileSync } from "node:child_process";

import { Document, Packer, Paragraph } from "docx";
import { expect, test } from "@playwright/test";

import { cardByHeading } from "./helpers/scoping";

/**
 * Full Phase 7 pipeline E2E coverage: extracted document -> segmentation job
 * -> worker CLI -> clause review (confirm/correct/reject) -> in-contract and
 * org-wide search -> clause standards CRUD -> clause-vs-standard comparison
 * -> review signal generation -> acknowledge/dismiss -> cross-org isolation.
 * Uses the deterministic development segmenter/classifier (the only
 * providers available without a real AI API key) - see
 * server/services/clauses/deterministic-korean-clause-segmenter.ts.
 */

const runId = Date.now();
const ownerEmail = `clause-e2e-owner-${runId}@e2e-test.local`;
const memberEmail = `clause-e2e-member-${runId}@e2e-test.local`;
const otherOwnerEmail = `clause-e2e-other-${runId}@e2e-test.local`;
const password = "Password123";
const contractTitle = `조항 구조화 E2E 계약 ${runId}`;
const standardName = `개발용 내부 참고 조항 - 손해배상 ${runId}`;

const CLAUSE1_TEXT = "본 계약은 물품 공급에 관한 사항을 정함을 목적으로 한다.";
const CLAUSE2_TEXT = "본 계약은 별도 통보가 없는 경우 자동갱신 됩니다.";
const CLAUSE3_TEXT = "을은 갑에게 발생한 모든 손해를 배상하여야 한다.";

async function buildContractDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

function runExtractionWorker() {
  execFileSync(
    "pnpm",
    ["exec", "dotenv", "-e", ".env.e2e", "--", "tsx", "scripts/process-extraction-jobs.ts", "--", "--limit=10"],
    { cwd: process.cwd(), stdio: "pipe", shell: process.platform === "win32" }
  );
}

/** Runs the clause segmentation worker CLI, exactly as an operator would via `pnpm clauses:process`. */
function runClauseSegmentationWorker() {
  execFileSync(
    "pnpm",
    [
      "exec",
      "dotenv",
      "-e",
      ".env.e2e",
      "--",
      "tsx",
      "scripts/process-clause-segmentation-jobs.ts",
      "--",
      "--limit=10",
    ],
    { cwd: process.cwd(), stdio: "pipe", shell: process.platform === "win32" }
  );
}

/** Runs the review signal generation CLI across all organizations, exactly as an operator would via `pnpm clauses:generate-signals`. */
function runClauseReviewSignalGenerator() {
  execFileSync(
    "pnpm",
    ["exec", "dotenv", "-e", ".env.e2e", "--", "tsx", "scripts/generate-clause-review-signals.ts"],
    { cwd: process.cwd(), stdio: "pipe", shell: process.platform === "win32" }
  );
}

async function signUp(
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

async function logIn(page: import("@playwright/test").Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/dashboard/);
}

let docxBuffer: Buffer;
let contractUrl = "";
let clausesUrl = "";
let standardUrl = "";

test.describe.serial("clause structuring, search, comparison, and review signals", () => {
  // §Phase 12.4 §10/§11 - see the upload-visibility assertion below and
  // scripts/run-e2e-prod.ts's warm-up comment: this file's first upload
  // (right after server startup, in QUEUE_SPECS order) measured up to 60s
  // even on an otherwise-idle host. Project default (90_000) leaves too
  // little room once that assertion's own budget is raised to 120_000.
  test.setTimeout(150_000);

  test.beforeAll(async () => {
    docxBuffer = await buildContractDocxBuffer([
      "본 문서는 조항 구조화 테스트를 위한 계약서입니다.",
      "제1조(목적)",
      CLAUSE1_TEXT,
      "제2조(계약기간)",
      CLAUSE2_TEXT,
      "제3조(손해배상)",
      CLAUSE3_TEXT,
    ]);
  });

  test("owner signs up and creates a contract", async ({ page }) => {
    await signUp(page, { name: "Clause E2E Owner", companyName: "Clause E2E Co", email: ownerEmail });
    await logIn(page, ownerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    contractUrl = new URL(page.url()).pathname;
    clausesUrl = `${contractUrl}/clauses`;
  });

  test("owner uploads a document and the extraction worker produces extracted text", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(contractUrl);
    // §Phase 12.4 §2/§5 - see ai-conversation-flow.spec.ts's identical
    // comment: guards against a real hydration race where setInputFiles()
    // fires before the upload form's onChange handler attaches, leaving
    // the "업로드" button permanently disabled.
    await page.waitForLoadState("networkidle");

    await page.setInputFiles("#contract-file", {
      name: "clause-source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docxBuffer,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    // Scoped to the "첨부 파일" card - the same filename also appears in
    // the separate "AI 및 문서 추출" table.
    // §Phase 12.4 §10/§11 - real measured cold-server latency, up to 60s
    // even on an otherwise-idle host (other apps closed, ~1% CPU) - not a
    // hung request. See scripts/run-e2e-prod.ts's warm-up comment for the
    // pg_stat_activity/server-log evidence ruling out a stuck query or
    // code bug; the GET-only warm-up there doesn't touch this step's real
    // bottleneck (the write path: storage put()/Prisma insert/Redis
    // rate-limit check), so this stays a generous, measured budget.
    await expect(cardByHeading(page, "첨부 파일").getByText("clause-source.docx")).toBeVisible({ timeout: 120_000 });

    // §Phase 15.1 - upload auto-starts the extraction job - no click needed here.
    const fileRow = page.getByRole("row").filter({ hasText: "clause-source.docx" });
    runExtractionWorker();
    await page.goto(contractUrl);
    await expect(fileRow.getByText("검토 필요")).toBeVisible();
  });

  test("clause segmentation auto-starts once the extracted document exists", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(contractUrl);

    await expect(page.getByText("계약 조항 분해")).toBeVisible();

    // §Phase 15.1 - AutoStartSegmentationTrigger fires client-side on
    // mount and refreshes the page once the job is created - no manual
    // "조항 분해 시작" click needed. expect().toBeVisible()'s own polling
    // covers the round trip.
    await expect(page.getByRole("button", { name: "조항 분해 시작" })).toHaveCount(0);
    await expect(page.getByText("대기 중")).toBeVisible();
  });

  test("segmentation worker CLI processes the job to REVIEW_REQUIRED and 조항 보기 opens the clause list", async ({
    page,
  }) => {
    runClauseSegmentationWorker();

    await logIn(page, ownerEmail);
    await page.goto(contractUrl);

    // Scoped to the "계약 조항 분해" card (ClauseSegmentationSection renders
    // its own status badge there, in a table keyed by extraction method/
    // char-count, not by filename) - not the file-list row, which shows the
    // (unrelated at this point) extraction job's own status.
    await expect(cardByHeading(page, "계약 조항 분해").getByText("검토 필요")).toBeVisible();
    const clauseViewLink = page.getByRole("link", { name: "조항 보기" });
    await expect(clauseViewLink).toBeVisible();
    await clauseViewLink.click();
    await page.waitForURL(/\/clauses\?jobId=/);
  });

  test("clause list shows the disclaimer and never duplicates the clause-number header inside the body text (regression)", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(clausesUrl);

    await expect(
      page.getByText(
        "이 기능은 계약 검토를 돕기 위한 보조 도구이며 법률 자문을 제공하지 않습니다. 최종 판단은 계약 담당자 또는 법률 전문가가 내려야 합니다."
      )
    ).toBeVisible();

    const clause1Section = page.locator("div.rounded-lg.border").filter({ hasText: "제1조" });
    await expect(clause1Section.getByText("제1조 목적")).toBeVisible();
    const clause1Body = clause1Section.locator("p.whitespace-pre-wrap").first();
    // If the header-duplication bug (fixed this phase) ever regresses, the
    // clause body would start with the raw "제1조(목적)" marker line again.
    await expect(clause1Body).not.toContainText("제1조(");
    await expect(clause1Body).toHaveText(CLAUSE1_TEXT);
  });

  test("owner confirms a clause classification", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(clausesUrl);

    const clause2Section = page.locator("div.rounded-lg.border").filter({ hasText: "제2조" });
    await expect(clause2Section.getByText("검토된 조항 유형").locator("..").getByText("계약기간")).toBeVisible();
    await clause2Section.getByRole("button", { name: "승인", exact: true }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();
    await expect(clause2Section.getByText("승인됨")).toBeVisible();
  });

  test("owner corrects a clause classification while preserving the original suggestion", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(clausesUrl);

    const clause1Section = page.locator("div.rounded-lg.border").filter({ hasText: "제1조" });
    await clause1Section.getByRole("button", { name: "수정", exact: true }).click();
    await clause1Section.getByRole("combobox").click();
    await page.getByRole("option", { name: "대금 지급" }).click();
    await clause1Section.getByRole("button", { name: "수정값 저장" }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();

    await expect(clause1Section.getByText("수정됨")).toBeVisible();
    // The original suggestion ("미분류") must never be overwritten by the
    // human correction - only reviewedClauseType changes.
    await expect(clause1Section.getByText("미분류")).toBeVisible();
    await expect(clause1Section.getByText("대금 지급")).toBeVisible();
  });

  test("owner rejects a clause classification", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(clausesUrl);

    const preambleSection = page.locator("div.rounded-lg.border").filter({ hasText: "(제목 없음)" }).first();
    await preambleSection.getByRole("button", { name: "거절", exact: true }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();
    await expect(preambleSection.getByText("거절됨")).toBeVisible();
  });

  test("in-contract clause search finds a matching clause with a highlighted snippet", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(clausesUrl);

    await page.getByPlaceholder("조항 내용, 번호, 제목으로 검색").fill("모든 손해");
    await page.getByRole("button", { name: "검색" }).click();
    await page.waitForURL(/\?q=/);

    await expect(page.getByText("제3조")).toBeVisible();
    await expect(page.locator("mark")).toBeVisible();
  });

  test("org-wide clause search finds the same clause and links back to its contract", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/clauses/search");

    await expect(
      page.getByText("이 조직에 속한 모든 계약의 조항을 검색합니다. 다른 조직의 조항은 검색되지 않습니다.")
    ).toBeVisible();

    await page.getByPlaceholder("조항 내용, 번호, 제목으로 검색").fill("모든 손해");
    await page.getByRole("button", { name: "검색" }).click();
    await page.waitForURL(/\?q=/);

    const resultLink = page.getByRole("link", { name: contractTitle });
    await expect(resultLink).toBeVisible();
    await resultLink.click();
    await page.waitForURL(new RegExp(contractUrl.replace(/\//g, "\\/") + "$"));
  });

  test("sidebar nav includes a working 조항 검색 link", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "조항 검색" }).click();
    await page.waitForURL(/\/clauses\/search$/);
  });

  test("owner invites a MEMBER, who is blocked from creating a clause standard", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/members");
    await page.getByLabel("이메일").fill(memberEmail);
    await page.getByRole("button", { name: "초대 보내기" }).click();
    const linkInput = page.getByLabel("생성된 초대 링크");
    await expect(linkInput).toBeVisible();
    const invitationUrl = await linkInput.inputValue();

    await page.context().clearCookies();
    await page.goto(invitationUrl);
    await page.getByLabel("이름").fill("Clause E2E Member");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입하고 초대 수락" }).click();
    await page.waitForURL(/\/login/);

    await logIn(page, memberEmail);
    await page.goto("/settings/clause-standards/new");
    await page.waitForURL(/\/settings\/clause-standards$/);
    await expect(page.getByRole("button", { name: "기준 조항 등록" })).toHaveCount(0);
  });

  test("owner creates an active clause standard for 손해배상", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/clause-standards/new");

    await page.getByLabel("이름 *").fill(standardName);
    await page.getByLabel("조항 유형 *").click();
    await page.getByRole("option", { name: "손해배상" }).click();
    await page.getByLabel("본문 *").fill(CLAUSE3_TEXT);
    await expect(page.getByRole("checkbox", { name: "활성 상태 (비교에 사용)" })).toBeChecked();
    await page.getByRole("button", { name: "기준 조항 등록" }).click();

    await page.waitForURL(/\/settings\/clause-standards\/[a-z0-9]{20,}$/);
    standardUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: standardName })).toBeVisible();
    await expect(page.getByText("활성", { exact: true })).toBeVisible();
  });

  test("standards list and detail page reflect the active standard", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/clause-standards");

    const row = page.getByRole("row").filter({ hasText: standardName });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "손해배상", exact: true })).toBeVisible();
    await expect(row.getByText("활성", { exact: true })).toBeVisible();

    await row.getByRole("link", { name: standardName }).click();
    await page.waitForURL(new RegExp(standardUrl.replace(/\//g, "\\/") + "$"));
    await expect(page.getByText(CLAUSE3_TEXT)).toBeVisible();
  });

  test("owner compares a clause to the standard and sees an identical-text result with no spurious differences (regression)", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(clausesUrl);

    const clause3Section = page.locator("div.rounded-lg.border").filter({ hasText: "제3조" });
    await clause3Section.getByRole("link", { name: "기준 조항과 비교" }).click();
    await page.waitForURL(/\/compare$/);

    await expect(page.getByText("기준 조항과 동일한 문구입니다.")).toBeVisible();
    // The header-duplication bug previously leaked "제3" as a spurious
    // numeric/amount token into the comparison - must show "-" (no diff).
    const numberRow = page.locator("div").filter({ hasText: "숫자 차이" }).last();
    await expect(numberRow.getByText("-", { exact: true })).toBeVisible();
    const amountRow = page.locator("div").filter({ hasText: "금액 차이" }).last();
    await expect(amountRow.getByText("-", { exact: true })).toBeVisible();
    await expect(
      page.getByText("문구 차이는 참고용입니다. 문자열 차이가 곧 법률적 중요성을 의미하지 않습니다.")
    ).toBeVisible();
  });

  test("owner edits the standard to inactive and the compare screen reflects no active standards", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(`${standardUrl}/edit`);
    await page.getByRole("checkbox", { name: "활성 상태 (비교에 사용)" }).click();
    await page.getByRole("button", { name: "수정 저장" }).click();
    await page.waitForURL(new RegExp(standardUrl.replace(/\//g, "\\/") + "$"));
    await expect(page.getByText("비활성", { exact: true })).toBeVisible();

    await page.goto(clausesUrl);
    const clause3Section = page.locator("div.rounded-lg.border").filter({ hasText: "제3조" });
    await clause3Section.getByRole("link", { name: "기준 조항과 비교" }).click();
    await page.waitForURL(/\/compare$/);
    await expect(page.getByText("손해배상 유형의 활성 기준 조항이 없습니다.")).toBeVisible();
  });

  test("owner deletes the standard", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(standardUrl);

    await page.getByRole("button", { name: "삭제" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "삭제" }).click();
    await page.waitForURL(/\/settings\/clause-standards$/);
    await expect(page.getByText(standardName)).toHaveCount(0);
  });

  test("review signal generation CLI creates signals visible on the review screen", async ({ page }) => {
    runClauseReviewSignalGenerator();

    await logIn(page, ownerEmail);
    await page.goto(`${contractUrl}/review`);

    await expect(
      page.getByText(
        "이 기능은 계약 검토를 돕기 위한 보조 도구이며 법률 자문을 제공하지 않습니다. 최종 판단은 계약 담당자 또는 법률 전문가가 내려야 합니다."
      )
    ).toBeVisible();
    await expect(page.getByText(/확인 필요 \d+건/)).toBeVisible();
    await expect(page.getByText("자동갱신 관련 표현이 포함되어 있습니다.")).toBeVisible();
    await expect(page.getByText("책임 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다.")).toBeVisible();
  });

  test("owner acknowledges one signal and dismisses another with a note; status filters reflect the changes", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(`${contractUrl}/review`);

    const autoRenewalCard = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "자동갱신 관련 표현이 포함되어 있습니다." });
    await autoRenewalCard.getByRole("button", { name: "확인함" }).click();
    await expect(page.getByText("검토 상태를 저장했습니다.")).toBeVisible();

    const liabilityCard = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "책임 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다." });
    await liabilityCard.getByPlaceholder("검토 메모를 남길 수 있습니다.").fill("검토 완료, 별도 조치 불필요");
    await liabilityCard.getByRole("button", { name: "검토 대상 아님" }).click();
    await expect(page.getByText("검토 상태를 저장했습니다.")).toBeVisible();

    await page.goto(`${contractUrl}/review?status=ACKNOWLEDGED`);
    await expect(page.getByText("자동갱신 관련 표현이 포함되어 있습니다.")).toBeVisible();
    await expect(page.getByText("책임 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다.")).toHaveCount(0);

    await page.goto(`${contractUrl}/review?status=DISMISSED`);
    await expect(page.getByText("책임 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다.")).toBeVisible();
    await expect(page.getByText("자동갱신 관련 표현이 포함되어 있습니다.")).toHaveCount(0);
  });

  test("a second organization cannot view this organization's clause list or review pages (404)", async ({
    page,
  }) => {
    await signUp(page, {
      name: "Clause E2E Other Owner",
      companyName: "Clause E2E Other Co",
      email: otherOwnerEmail,
    });
    await logIn(page, otherOwnerEmail);

    await page.goto(clausesUrl);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();

    await page.goto(`${contractUrl}/review`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});
