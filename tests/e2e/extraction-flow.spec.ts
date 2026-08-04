import { execFileSync } from "node:child_process";

import { Document, Packer, Paragraph } from "docx";
import { expect, test } from "@playwright/test";

/**
 * Full extraction pipeline E2E coverage: upload -> start job -> worker CLI
 * (a real child process, like runNotificationGenerator() in
 * invitation-and-permissions-flow.spec.ts) -> review screen -> per-field
 * accept/edit/reject -> apply -> contract updated. Uses the deterministic
 * development extractor (the only provider available without a real AI
 * API key) - see server/services/extraction/deterministic-development-contract-extractor.ts.
 */

const runId = Date.now();
const ownerEmail = `extract-e2e-owner-${runId}@e2e-test.local`;
const memberEmail = `extract-e2e-member-${runId}@e2e-test.local`;
const otherOwnerEmail = `extract-e2e-other-${runId}@e2e-test.local`;
const password = "Password123";
const contractTitle = `추출 E2E 계약 ${runId}`;
const suggestedTitle = `추출 E2E 계약 ${runId} (문서 기준)`;
const contractNumber = `E2E-EXTRACT-${runId}`;
const counterpartyName = `E2E 추출 상대방 ${runId}`;

async function buildContractDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

function buildFakeDocxBuffer(): Buffer {
  // Passes the upload signature check (ZIP header + OOXML markers) but is
  // not a real ZIP archive, so text extraction fails deterministically at
  // processing time - used to exercise the FAILED/재시도 UI path.
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const marker = Buffer.from("[Content_Types].xml word/document.xml not a real docx", "latin1");
  return Buffer.concat([header, marker]);
}

/** Runs the extraction worker CLI against the E2E test database, exactly as an operator would via `pnpm extraction:process`. */
function runExtractionWorker() {
  execFileSync(
    "pnpm",
    [
      "exec",
      "dotenv",
      "-e",
      ".env.test",
      "--",
      "tsx",
      "scripts/process-extraction-jobs.ts",
      "--",
      "--limit=10",
    ],
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

let goodDocxBuffer: Buffer;
let secondDocxBuffer: Buffer;
let contractUrl = "";
let reviewUrl = "";
let invitationUrl = "";

test.describe.serial("contract extraction: upload -> worker -> review -> apply", () => {
  test.beforeAll(async () => {
    goodDocxBuffer = await buildContractDocxBuffer([
      `계약명: ${suggestedTitle}`,
      `계약번호: ${contractNumber}`,
      `상대방: ${counterpartyName}`,
      "본 계약은 자동갱신 됩니다.",
    ]);
    secondDocxBuffer = await buildContractDocxBuffer([
      "계약명: 두 번째 검토자 문서",
      "계약번호: MEMBER-REVIEW-001",
    ]);
  });

  test("owner signs up and creates a contract with a counterparty available", async ({ page }) => {
    await signUp(page, { name: "Extract E2E Owner", companyName: "Extract E2E Co", email: ownerEmail });
    await logIn(page, ownerEmail);

    await page.goto("/counterparties/new");
    await page.getByLabel("상대방명 *").fill(counterpartyName);
    await page.getByRole("button", { name: "상대방 등록" }).click();
    await page.waitForURL(/\/counterparties\/(?!new$)[a-z0-9]{20,}$/);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    contractUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: contractTitle })).toBeVisible();
  });

  test("owner uploads a file and starts an extraction job (PENDING)", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(contractUrl);

    await page.setInputFiles("#contract-file", {
      name: "extraction-source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: goodDocxBuffer,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    await expect(page.getByText("extraction-source.docx").first()).toBeVisible();

    const fileRow = page.getByRole("row").filter({ hasText: "extraction-source.docx" });
    await fileRow.getByRole("button", { name: "정보 추출" }).click();
    await expect(page.getByText("정보 추출을 시작했습니다.")).toBeVisible();

    // Once a job exists, the UI offers no way to start a second one for
    // the same file - the start button is replaced by a status link
    // (positive expression of the dedup rule enforced server-side).
    await expect(fileRow.getByRole("button", { name: "정보 추출" })).toHaveCount(0);
    await expect(fileRow.getByText("대기 중")).toBeVisible();

    // Never uses the phrase "AI 분석 완료" for plain text extraction.
    await expect(page.getByText("AI 분석 완료")).toHaveCount(0);
  });

  test("worker CLI processes the job to REVIEW_REQUIRED", async ({ page }) => {
    runExtractionWorker();

    await logIn(page, ownerEmail);
    await page.goto(contractUrl);

    const fileRow = page.getByRole("row").filter({ hasText: "extraction-source.docx" });
    await expect(fileRow.getByText("검토 필요")).toBeVisible();
    const reviewLink = fileRow.getByRole("link", { name: "검토하기" });
    await expect(reviewLink).toBeVisible();
    await reviewLink.click();
    await page.waitForURL(/\/extractions\/[a-z0-9]{20,}$/);
    reviewUrl = new URL(page.url()).pathname;
  });

  test("review screen shows job metadata and per-field current vs suggested values", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(reviewUrl);

    await expect(page.getByRole("heading", { name: "추출 결과 검토" })).toBeVisible();
    await expect(page.getByText("mammoth")).toBeVisible();

    const contractNumberSection = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "계약번호" })
      .first();
    // 계약번호 was never set at contract creation, so the current value must
    // show "-", while the suggested value and its source snippet show the
    // document's number - and a fixed 0.6 dev-extractor confidence maps to
    // the "보통" band (see confidenceBandLabel's 0.4-0.7 range).
    await expect(contractNumberSection.getByText("-", { exact: true })).toBeVisible();
    await expect(contractNumberSection.getByText(contractNumber, { exact: true })).toBeVisible();
    await expect(contractNumberSection.getByText(`계약번호: ${contractNumber}`)).toBeVisible();
    await expect(contractNumberSection.getByText("신뢰도: 보통")).toBeVisible();
  });

  test("owner accepts, edits, and rejects individual suggestions", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(reviewUrl);

    // 계약번호 - accept as-is.
    const contractNumberSection = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "계약번호" })
      .first();
    await contractNumberSection.getByRole("button", { name: "승인", exact: true }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();

    // 계약명 - edit then accept.
    const titleSection = page.locator("div.rounded-lg.border").filter({ hasText: "계약명" }).first();
    await titleSection.getByRole("button", { name: "수정 후 승인" }).click();
    const titleInput = titleSection.locator("input[type=text]").first();
    await titleInput.fill(`${suggestedTitle} - 검토 반영`);
    await titleSection.getByRole("button", { name: "수정값 저장" }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();

    // 자동갱신 - reject.
    const autoRenewalSection = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "자동갱신" })
      .first();
    await autoRenewalSection.getByRole("button", { name: "거절", exact: true }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();
  });

  test("owner picks an existing counterparty for the counterpartyName suggestion", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(reviewUrl);

    const counterpartySection = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "계약 상대방" })
      .first();
    // No direct "승인" option for a bare counterparty name suggestion.
    await expect(counterpartySection.getByRole("button", { name: "승인", exact: true })).toHaveCount(
      0
    );
    await counterpartySection.getByRole("button", { name: "상대방 선택" }).click();
    await counterpartySection.getByLabel("상대방 선택").click();
    await page.getByRole("option", { name: counterpartyName }).click();
    await counterpartySection.getByRole("button", { name: "수정값 저장" }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();
  });

  test("applying reflects only approved suggestions and leaves the rejected field unchanged", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(reviewUrl);

    await page.getByRole("button", { name: "승인한 항목 계약에 적용" }).click();
    await page.waitForURL(new RegExp(contractUrl.replace(/\//g, "\\/") + "$"));
    await expect(page.getByText(/개 항목을 계약에 반영했습니다\./)).toBeVisible();

    await expect(page.getByRole("heading", { name: `${suggestedTitle} - 검토 반영` })).toBeVisible();
    await expect(page.getByText(contractNumber)).toBeVisible();
    await expect(page.getByText(counterpartyName).first()).toBeVisible();
    // autoRenewal was REJECTED during review - the contract's original
    // manually-set value ("아니오", the create-form default) must survive.
    await expect(page.getByText("아니오")).toBeVisible();

    const fileRow = page.getByRole("row").filter({ hasText: "extraction-source.docx" });
    await expect(fileRow.getByText("완료")).toBeVisible();
  });

  test("owner invites a MEMBER, who can also review a separately-uploaded file", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/members");
    await page.getByLabel("이메일").fill(memberEmail);
    await page.getByRole("button", { name: "초대 보내기" }).click();
    const linkInput = page.getByLabel("생성된 초대 링크");
    await expect(linkInput).toBeVisible();
    invitationUrl = await linkInput.inputValue();

    await page.context().clearCookies();
    await page.goto(invitationUrl);
    await page.getByLabel("이름").fill("Extract E2E Member");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입하고 초대 수락" }).click();
    await page.waitForURL(/\/login/);

    await logIn(page, memberEmail);
    await page.goto(contractUrl);
    await page.setInputFiles("#contract-file", {
      name: "member-source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: secondDocxBuffer,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    await expect(page.getByText("member-source.docx").first()).toBeVisible();

    const memberFileRow = page.getByRole("row").filter({ hasText: "member-source.docx" });
    await memberFileRow.getByRole("button", { name: "정보 추출" }).click();
    await expect(page.getByText("정보 추출을 시작했습니다.")).toBeVisible();

    runExtractionWorker();
    await page.goto(contractUrl);
    const reviewLink = page
      .getByRole("row")
      .filter({ hasText: "member-source.docx" })
      .getByRole("link", { name: "검토하기" });
    await reviewLink.click();
    await page.waitForURL(/\/extractions\/[a-z0-9]{20,}$/);

    const memberContractNumberSection = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "계약번호" })
      .first();
    await memberContractNumberSection.getByRole("button", { name: "승인", exact: true }).click();
    await expect(page.getByText("검토 결과를 저장했습니다.")).toBeVisible();
  });

  test("a second organization cannot view this organization's review page (404)", async ({
    page,
  }) => {
    await signUp(page, {
      name: "Extract E2E Other Owner",
      companyName: "Extract E2E Other Co",
      email: otherOwnerEmail,
    });
    await logIn(page, otherOwnerEmail);
    await page.goto(reviewUrl);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });

  test("a failed extraction shows a safe error reason and a working 재시도 button", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto(contractUrl);

    await page.setInputFiles("#contract-file", {
      name: "broken-source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: buildFakeDocxBuffer(),
    });
    await page.getByRole("button", { name: "업로드" }).click();
    await expect(page.getByText("broken-source.docx").first()).toBeVisible();

    const brokenFileRow = page.getByRole("row").filter({ hasText: "broken-source.docx" });
    await brokenFileRow.getByRole("button", { name: "정보 추출" }).click();
    await expect(page.getByText("정보 추출을 시작했습니다.")).toBeVisible();

    runExtractionWorker();
    await page.goto(contractUrl);

    const failedFileRow = page.getByRole("row").filter({ hasText: "broken-source.docx" });
    await expect(failedFileRow.getByText("실패")).toBeVisible();
    await expect(failedFileRow.getByText("문서에서 텍스트를 추출하지 못했습니다.")).toBeVisible();

    const retryButton = failedFileRow.getByRole("button", { name: "재시도" });
    await expect(retryButton).toBeVisible();
    await retryButton.click();
    await expect(page.getByText("정보 추출을 시작했습니다.")).toBeVisible();
    await expect(failedFileRow.getByText("대기 중")).toBeVisible();
  });
});
