import { expect, test } from "@playwright/test";

/**
 * MEMBER-role delete restrictions are intentionally NOT re-tested here.
 * There is no UI to create a second (MEMBER) account in this phase (no
 * member-invite feature yet), and Playwright's default TS transform cannot
 * load the generated Prisma client (it uses import.meta, which requires
 * ESM handling this project does not enable project-wide) to seed one
 * directly. That exact scenario - MEMBER blocked from deleting, both via
 * the server action and by inspecting the DB row - is covered by
 * tests/integration/contracts.test.ts instead.
 */

const runId = Date.now();
const ownerEmail = `contracts-e2e-owner-${runId}@e2e-test.local`;
const otherOwnerEmail = `contracts-e2e-other-${runId}@e2e-test.local`;
const password = "Password123";
const contractTitle = `E2E 계약 ${runId}`;
const otherOrgContractTitle = `다른 조직 계약 ${runId}`;

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
  // An already-authenticated session on /login auto-redirects to
  // /dashboard, so switching accounts within one test needs a clean
  // session first.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/dashboard/);
}

let otherOrgContractUrl = "";

test.describe.serial("contract CRUD, search, and cross-org isolation", () => {
  test("signup creates the owner account", async ({ page }) => {
    await signUp(page, { name: "E2E Owner", companyName: "E2E Contracts Co", email: ownerEmail });
  });

  test("owner logs in, creates a contract, and sees it in the list", async ({ page }) => {
    await logIn(page, ownerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);

    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();

    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    await expect(page.getByRole("heading", { name: contractTitle })).toBeVisible();

    await page.goto("/contracts");
    await page.getByLabel("검색").fill(contractTitle);
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page.getByRole("link", { name: contractTitle })).toBeVisible();
  });

  test("owner edits the contract", async ({ page }) => {
    await logIn(page, ownerEmail);

    await page.goto("/contracts");
    await page.getByLabel("검색").fill(contractTitle);
    await page.getByRole("button", { name: "검색" }).click();
    await page.getByRole("link", { name: contractTitle }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);

    await page.getByRole("button", { name: "수정" }).click();
    await page.waitForURL(/\/edit$/);

    const updatedTitle = `${contractTitle} (수정됨)`;
    await page.getByLabel("계약명 *").fill(updatedTitle);
    await page.getByRole("button", { name: "수정 저장" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();

    // Restore the original title for the later steps' search-by-title.
    await page.getByRole("button", { name: "수정" }).click();
    await page.waitForURL(/\/edit$/);
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByRole("button", { name: "수정 저장" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
  });

  test("a second organization's contract is invisible to the first owner (404)", async ({
    page,
  }) => {
    await signUp(page, {
      name: "E2E Other Owner",
      companyName: "E2E Other Org",
      email: otherOwnerEmail,
    });

    await logIn(page, otherOwnerEmail);
    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(otherOrgContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "기타" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    otherOrgContractUrl = new URL(page.url()).pathname;

    await logIn(page, ownerEmail);
    // In Next.js dev mode the initial document response for a notFound()
    // boundary is not reliably reported as HTTP 404 by Playwright's
    // response object, so this asserts on the actually rendered content -
    // a more direct proof of what the user sees anyway.
    await page.goto(otherOrgContractUrl);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(otherOrgContractTitle)).toHaveCount(0);
  });

  test("owner deletes the contract, it disappears from the list, and its URL 404s", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);

    await page.goto("/contracts");
    await page.getByLabel("검색").fill(contractTitle);
    await page.getByRole("button", { name: "검색" }).click();
    await page.getByRole("link", { name: contractTitle }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    const deletedContractUrl = new URL(page.url()).pathname;

    await expect(page.getByRole("button", { name: "삭제" })).toBeVisible();
    await page.getByRole("button", { name: "삭제" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "삭제" }).click();
    await page.waitForURL(/\/contracts$/);

    await page.getByLabel("검색").fill(contractTitle);
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page.getByText("조건에 맞는 계약이 없습니다.")).toBeVisible();

    await page.goto(deletedContractUrl);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });

  test("filters the list by contract type", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(`${contractTitle} NDA`);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "비밀유지계약(NDA)" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);

    await page.goto("/contracts");
    await page.getByLabel("검색").fill(contractTitle);
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page.getByRole("link", { name: `${contractTitle} NDA` })).toBeVisible();

    await page.getByRole("combobox", { name: "계약 유형" }).click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await expect(page.getByRole("link", { name: `${contractTitle} NDA` })).toHaveCount(0);
  });
});
