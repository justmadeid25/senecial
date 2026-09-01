import { expect, test } from "@playwright/test";

import { cardByHeading } from "./helpers/scoping";

/**
 * As with contracts-flow.spec.ts, MEMBER-role restrictions (file delete,
 * counterparty delete) are not re-tested here for the same reason: there is
 * no UI to create a second (MEMBER) account in this phase. Those exact
 * scenarios are covered by tests/integration/counterparties.test.ts and
 * tests/integration/contract-files.test.ts instead.
 */

const runId = Date.now();
const ownerEmail = `cp-e2e-owner-${runId}@e2e-test.local`;
const otherOwnerEmail = `cp-e2e-other-${runId}@e2e-test.local`;
const password = "Password123";
const counterpartyName = `E2E 상대방 ${runId}`;
const contractTitle = `E2E 상대방 연결 계약 ${runId}`;

const PDF_BUFFER = Buffer.from("%PDF-1.7\n%e2e test contract file\n1 0 obj\n", "latin1");

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

let counterpartyUrl = "";
let contractUrl = "";
let downloadUrl: string | null = "";

test.describe.serial("counterparty CRUD, file upload/download/delete, and isolation", () => {
  test("signup creates the owner account", async ({ page }) => {
    await signUp(page, { name: "E2E Owner", companyName: "E2E Counterparty Co", email: ownerEmail });
  });

  test("owner creates a counterparty and sees it in the list", async ({ page }) => {
    await logIn(page, ownerEmail);

    await page.goto("/counterparties/new");
    await page.getByLabel("상대방명 *").fill(counterpartyName);
    await page.getByLabel("담당자 이메일").fill("contact@e2e-test.local");
    await page.getByRole("button", { name: "상대방 등록" }).click();
    await page.waitForURL(/\/counterparties\/(?!new$)[a-z0-9]{20,}$/);
    await expect(page.getByRole("heading", { name: counterpartyName })).toBeVisible();
    counterpartyUrl = new URL(page.url()).pathname;

    await page.goto("/counterparties");
    await page.getByLabel("검색").fill(counterpartyName);
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page.getByRole("link", { name: counterpartyName })).toBeVisible();
  });

  test("owner edits the counterparty", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(counterpartyUrl);
    await page.getByRole("button", { name: "수정" }).click();
    await page.waitForURL(/\/edit$/);

    await page.getByLabel("담당자명").fill("수정된 담당자");
    await page.getByRole("button", { name: "수정 저장" }).click();
    await page.waitForURL(/\/counterparties\/(?!new$)[a-z0-9]{20,}$/);
    await expect(page.getByText("수정된 담당자")).toBeVisible();
  });

  test("owner links a contract to the counterparty, then deletion is blocked", async ({ page }) => {
    await logIn(page, ownerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByLabel("계약 상대방").click();
    await page.getByRole("option", { name: counterpartyName }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    contractUrl = new URL(page.url()).pathname;

    await page.goto(counterpartyUrl);
    await expect(page.getByText(`연결된 계약 (1)`)).toBeVisible();

    await page.getByRole("button", { name: "삭제" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "삭제" }).click();
    // Scoped to the dialog specifically - the same message also appears in
    // a toast notification elsewhere on the page.
    await expect(
      page.getByRole("dialog").getByText("이 상대방과 연결된 계약이 있어 삭제할 수 없습니다.")
    ).toBeVisible();
  });

  test("a second organization cannot view the first owner's counterparty (404)", async ({ page }) => {
    await signUp(page, {
      name: "E2E Other Owner",
      companyName: "E2E Other Org",
      email: otherOwnerEmail,
    });

    await logIn(page, otherOwnerEmail);
    // Next.js dev-mode notFound() boundaries don't reliably report a true
    // HTTP 404 via Playwright's response object - assert on rendered
    // content instead, matching contracts-flow.spec.ts's approach.
    await page.goto(counterpartyUrl);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });

  test("owner uploads a file to the linked contract and sees it in the file list", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(contractUrl);
    // §Phase 12.4 §2/§5 - see ai-conversation-flow.spec.ts's identical
    // comment: guards against a real hydration race where setInputFiles()
    // fires before the upload form's onChange handler attaches, leaving
    // the "업로드" button permanently disabled.
    await page.waitForLoadState("networkidle");

    await page.setInputFiles("#contract-file", {
      name: "e2e-계약서.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BUFFER,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    // The filename also appears in the "AI 및 문서 추출" table (added Phase
    // 6) - scoped to the "첨부 파일" card specifically, not an unscoped
    // .first() that would pass regardless of which table actually shows it.
    await expect(cardByHeading(page, "첨부 파일").getByText("e2e-계약서.pdf")).toBeVisible({ timeout: 30_000 });
  });

  test("owner downloads the uploaded file", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(contractUrl);

    downloadUrl = await page.getByRole("link", { name: "다운로드" }).getAttribute("href");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "다운로드" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("e2e-계약서.pdf");
  });

  // §Phase 14 Part 2 - RELEASE BLOCKER #1 (cross-tenant isolation) - a
  // deliberate adversarial attack: a second organization's authenticated
  // user hits the FIRST organization's real file download URL directly
  // (not through the UI, which never shows a link to a file that isn't
  // theirs - this bypasses the UI entirely and exercises the actual route
  // handler's own authorization, matching how a real attacker who somehow
  // learned/guessed the URL would behave). The download route's own triple
  // scope check (contract must belong to the actor's org AND the file must
  // belong to both that org and that contract - never just a bare file id)
  // must reject this with 404, never the real file bytes.
  test("a second organization cannot download the first organization's file via its real URL (cross-tenant attack)", async ({ page }) => {
    expect(downloadUrl, "download URL must have been captured by the prior test").toBeTruthy();
    await logIn(page, otherOwnerEmail);
    const response = await page.request.get(downloadUrl!);
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("%PDF");
  });

  test("owner deletes the file and it disappears from the list", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto(contractUrl);

    // Scoped to the "첨부 파일" card - the same filename also appears in
    // the separate "AI 및 문서 추출" table.
    await expect(cardByHeading(page, "첨부 파일").getByText("e2e-계약서.pdf")).toBeVisible({ timeout: 30_000 });
    // Scoped to the file's own table row - the page also has a top-level
    // "삭제" button for deleting the whole contract, with the same label.
    const fileRow = page.getByRole("row").filter({ hasText: "e2e-계약서.pdf" });
    await fileRow.getByRole("button", { name: "삭제" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "삭제" }).click();
    await expect(page.getByText("업로드된 파일이 없습니다.")).toBeVisible();
  });
});
