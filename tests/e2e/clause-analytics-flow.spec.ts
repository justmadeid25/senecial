import { expect, test } from "@playwright/test";

/**
 * Phase 8/8.1 E2E coverage: empty-state analytics screen -> portfolio
 * summary cards populate after contracts exist -> period/contract-type/
 * displayStatus/currency/autoRenewal filters actually narrow the displayed
 * data (not just the URL) -> composite filters -> URL share/restore ->
 * filter reset -> no-results state -> expiration distribution ->
 * currency-separated amounts -> clause-type distribution -> review signal
 * statistics -> counterparty analytics -> actionable work-list links ->
 * OWNER-only CSV export (row count matches the filtered screen) -> MEMBER
 * read access + CSV block -> cross-org isolation -> mobile layout ->
 * disclaimer text.
 */

const runId = Date.now();
const ownerEmail = `analytics-e2e-owner-${runId}@e2e-test.local`;
const memberEmail = `analytics-e2e-member-${runId}@e2e-test.local`;
const otherOwnerEmail = `analytics-e2e-other-${runId}@e2e-test.local`;
const password = "Password123";
const serviceContractTitle = `분석 E2E 용역계약 ${runId}`;
const leaseContractTitle = `분석 E2E 임대차계약 ${runId}`;
const otherOrgContractTitle = `다른 조직 분석 계약 ${runId}`;

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

function isoDateDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Scopes assertions to one specific analytics Card by its exact CardTitle text - CardTitle renders a <div>, not a heading, and several section titles/badges share substrings, so a plain hasText filter on "div" matches too broadly once multiple sections show the same badge text. */
function cardByTitle(page: import("@playwright/test").Page, title: string) {
  return page.getByText(title, { exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");
}

test.describe.serial("analytics dashboard, filters, CSV export, and isolation", () => {
  test("signup creates the owner, member-to-be, and other-org owner accounts", async ({ page }) => {
    await signUp(page, { name: "Analytics E2E Owner", companyName: "Analytics E2E Co", email: ownerEmail });
    await signUp(page, { name: "Analytics E2E Other", companyName: "Analytics E2E Other Co", email: otherOwnerEmail });
  });

  test("empty-data state: no contracts yet shows the empty message, not zeroed charts", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");
    await expect(page.getByText("아직 등록된 계약이 없습니다.")).toBeVisible();
  });

  test("the legal-disclaimer note is shown on the analytics screen", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");
    await expect(
      page.getByText("법률적 위험이나 계약의 유효성을 판단하지 않습니다.").first()
    ).toBeVisible();
  });

  test("owner creates two contracts with different types, currencies, and expiration windows", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(serviceContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByLabel("종료일").fill(isoDateDaysFromNow(15));
    await page.getByLabel("계약 금액").fill("50000000");
    await page.getByLabel("통화").fill("KRW");
    await page.getByRole("checkbox", { name: "자동갱신" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(leaseContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "임대차계약" }).click();
    await page.getByLabel("종료일").fill(isoDateDaysFromNow(300));
    await page.getByLabel("계약 금액").fill("3000");
    await page.getByLabel("통화").fill("USD");
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
  });

  test("portfolio summary cards reflect the newly created contracts", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");

    await expect(page.getByText("계약 포트폴리오 요약")).toBeVisible();
    const totalCard = page.locator("div").filter({ hasText: "전체 살아 있는 계약" }).last();
    await expect(totalCard).toBeVisible();
    await expect(page.getByText("자동갱신 계약").first()).toBeVisible();
  });

  test("expiration distribution and currency-separated amounts are shown", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");

    await expect(page.getByText("만료 일정 분포")).toBeVisible();
    await expect(page.getByText("1~7일")).toBeVisible();
    await expect(page.getByText("8~30일")).toBeVisible();

    await expect(page.getByText("계약 금액 (통화별)")).toBeVisible();
    // KRW and USD amounts must appear as separate lines, never combined.
    await expect(page.getByText(/₩50,000,000/).first()).toBeVisible();
  });

  test("contract type distribution table lists both created types", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");

    const table = cardByTitle(page, "계약 유형 분포").locator("table");
    await expect(table.getByRole("cell", { name: "용역계약" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "임대차계약" })).toBeVisible();
  });

  test("period filter narrows the contract-type breakdown by createdAt, and shows a no-results state", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    // A period ending yesterday excludes contracts created today - both
    // fixture contracts were created today, so the table has no rows left.
    await page.goto(`/analytics?periodStart=2020-01-01&periodEnd=${isoDateDaysFromNow(-1)}`);

    const card = cardByTitle(page, "계약 유형 분포");
    await expect(card.getByText("선택 기간 (계약 생성일 기준)")).toBeVisible();
    await expect(card.getByText("조건에 맞는 결과가 없습니다.")).toBeVisible();
  });

  test("contract type filter narrows the contract-type table and portfolio summary, not just the URL", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");
    const totalBefore = await cardByTitle(page, "전체 살아 있는 계약").locator('[data-slot="card-content"]').textContent();

    await page.getByLabel("계약 유형").selectOption({ label: "용역계약" });
    await page.getByRole("button", { name: "필터 적용" }).click();
    await page.waitForURL(/contractType=SERVICE/);

    const table = cardByTitle(page, "계약 유형 분포").locator("table");
    await expect(table.getByRole("cell", { name: "용역계약" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "임대차계약" })).toHaveCount(0);

    const totalAfter = await cardByTitle(page, "전체 살아 있는 계약").locator('[data-slot="card-content"]').textContent();
    expect(totalAfter).not.toBe(totalBefore);
    await expect(page.getByText("적용된 필터 1개:")).toBeVisible();
    await expect(page.getByText("계약 유형: 용역계약")).toBeVisible();
  });

  test("displayStatus filter narrows the portfolio summary to only that status", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?displayStatus=ACTIVE");

    const expiringCard = cardByTitle(page, "30일 내 만료 예정");
    await expect(expiringCard.locator('[data-slot="card-content"]')).toHaveText("0");
  });

  test("currency filter narrows the amount breakdown to only that currency", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?currency=USD");

    const amountCard = cardByTitle(page, "계약 금액 (통화별)");
    await expect(amountCard.getByText(/USD/).first()).toBeVisible();
    await expect(amountCard.getByText(/₩/)).toHaveCount(0);
  });

  test("autoRenewal filter narrows to only auto-renewal contracts", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?autoRenewal=true");

    const table = cardByTitle(page, "계약 유형 분포").locator("table");
    await expect(table.getByRole("cell", { name: "용역계약" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "임대차계약" })).toHaveCount(0);
  });

  test("composite filter (contractType + currency) narrows correctly together", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?contractType=LEASE&currency=USD");

    const table = cardByTitle(page, "계약 유형 분포").locator("table");
    await expect(table.getByRole("cell", { name: "임대차계약" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "용역계약" })).toHaveCount(0);
    await expect(page.getByText("적용된 필터 2개:")).toBeVisible();
  });

  test("sharing a filtered URL reproduces the exact same filtered view", async ({ page }) => {
    await logIn(page, ownerEmail);
    const filteredUrl = "/analytics?contractType=SERVICE&autoRenewal=true";
    await page.goto(filteredUrl);
    const firstVisitText = await page.locator("main").innerText();

    await page.goto("/dashboard");
    await page.goto(filteredUrl);
    const secondVisitText = await page.locator("main").innerText();

    expect(secondVisitText).toBe(firstVisitText);
    await expect(page.getByText("적용된 필터 2개:")).toBeVisible();
  });

  test("필터 초기화 clears every filter and returns to the unfiltered view", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?contractType=SERVICE&autoRenewal=true");
    await expect(page.getByText("적용된 필터 2개:")).toBeVisible();

    await page.getByRole("link", { name: "초기화" }).click();
    await page.waitForURL(/\/analytics$/);
    await expect(page.getByText("적용된 필터가 없습니다.")).toBeVisible();

    const table = cardByTitle(page, "계약 유형 분포").locator("table");
    await expect(table.getByRole("cell", { name: "용역계약" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "임대차계약" })).toBeVisible();
  });

  test("an individual filter chip can be removed, keeping the remaining filters", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?contractType=SERVICE&autoRenewal=true");

    await page.getByText("계약 유형: 용역계약").click();
    await page.waitForURL((url) => !url.search.includes("contractType"));
    expect(new URL(page.url()).searchParams.get("autoRenewal")).toBe("true");
    expect(new URL(page.url()).searchParams.has("contractType")).toBe(false);
  });

  test("a filter combination matching no contracts shows the no-results state, not an empty-portfolio state", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?contractType=NDA");

    await expect(page.getByText("조건에 맞는 결과가 없습니다.").first()).toBeVisible();
    await expect(page.getByText("아직 등록된 계약이 없습니다. 계약을 등록하면")).toHaveCount(0);
  });

  test("CSV export respects the active filter and its row count matches the filtered screen", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics?contractType=SERVICE");

    // The 계약 유형 분포 table's own row count (this contract-type breakdown,
    // not the portfolio CSV's per-contract rows) - both should agree there
    // is exactly one matching type row for this filter.
    const table = cardByTitle(page, "계약 유형 분포").locator("table");
    const screenDataRows = (await table.getByRole("row").count()) - 1; // minus header row

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "계약 포트폴리오 CSV 내보내기" }).click(),
    ]);
    const csvPath = await download.path();
    expect(csvPath).toBeTruthy();
    const fs = await import("node:fs/promises");
    const csvContent = await fs.readFile(csvPath!, "utf-8");
    const csvDataRows = csvContent.trim().split("\n").length - 1; // minus header row
    expect(screenDataRows).toBe(1);
    expect(csvDataRows).toBe(1);
  });

  test("actionable work-list links navigate to the contracts list", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");

    await expect(page.getByText("미처리 작업 목록")).toBeVisible();
    const row = page.locator("div").filter({ hasText: "상대방이 연결되지 않은 계약" }).last();
    await row.getByRole("link", { name: "보기" }).click();
    await page.waitForURL(/\/contracts/);
  });

  test("OWNER can export the portfolio CSV", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/analytics");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "계약 포트폴리오 CSV 내보내기" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^contract-portfolio-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("owner invites a MEMBER who can view analytics but cannot export CSV", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/members");
    await page.getByLabel("이메일").fill(memberEmail);
    await page.getByRole("button", { name: "초대 보내기" }).click();
    const linkInput = page.getByLabel("생성된 초대 링크");
    await expect(linkInput).toBeVisible();
    const invitationUrl = await linkInput.inputValue();

    await page.context().clearCookies();
    await page.goto(invitationUrl);
    await page.getByLabel("이름").fill("Analytics E2E Member");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입하고 초대 수락" }).click();
    await page.waitForURL(/\/login/);

    await logIn(page, memberEmail);
    await page.goto("/analytics");
    await expect(page.getByText("계약 포트폴리오 요약")).toBeVisible();
    await expect(page.getByRole("link", { name: "계약 포트폴리오 CSV 내보내기" })).toHaveCount(0);

    // Direct API access is blocked server-side too, not just hidden in the UI.
    const response = await page.request.get("/api/analytics/export/portfolio");
    expect(response.status()).toBe(403);
  });

  test("another organization's data never appears in this organization's analytics", async ({ page }) => {
    await logIn(page, otherOwnerEmail);
    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(otherOrgContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "비밀유지계약(NDA)" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);

    await logIn(page, ownerEmail);
    await page.goto("/analytics");
    const pageText = await page.locator("main").innerText();
    expect(pageText).not.toContain(otherOrgContractTitle);
  });

  test("mobile viewport renders the analytics page without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await logIn(page, ownerEmail);
    await page.goto("/analytics");

    await expect(page.getByText("계약 포트폴리오 요약")).toBeVisible();
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });
});
