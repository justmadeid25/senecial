import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

/**
 * End-to-end coverage of the invitation -> MEMBER-permission flow this
 * Phase specifically adds. Unlike contracts-flow.spec.ts and
 * counterparties-and-files-flow.spec.ts (which could not create a real
 * MEMBER account and had to defer that coverage to integration tests),
 * this spec creates a genuine MEMBER account via the new invitation flow
 * and exercises its restrictions directly through the UI.
 */

const runId = Date.now();
const ownerEmail = `perm-e2e-owner-${runId}@e2e-test.local`;
const memberEmail = `perm-e2e-member-${runId}@e2e-test.local`;
const password = "Password123";
const contractTitle = `권한 테스트 계약 ${runId}`;
const notificationContractTitle = `알림 테스트 계약 ${runId}`;

async function logIn(page: import("@playwright/test").Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** KST calendar date, N days from today, as "YYYY-MM-DD" for an <input type="date">. */
function kstDateInputValue(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

/**
 * Runs the notification-generation CLI against the E2E test database
 * (.env.test) as a real child process - this is Node-level `child_process`
 * usage in the test file itself, not a Prisma import, so it does not hit
 * the import.meta/ESM transform limitation that keeps Prisma out of these
 * spec files directly.
 *
 * `--force` (Phase 9 §27/§28) bypasses the CLI's own "once per day"
 * dedup window - this script is meant to be run on demand for this test,
 * potentially more than once per calendar day across repeated local/CI
 * runs, which the production default (daily cadence) would otherwise
 * silently skip.
 */
function runNotificationGenerator() {
  execFileSync(
    "pnpm",
    ["exec", "dotenv", "-e", ".env.test", "--", "tsx", "scripts/generate-notifications.ts", "--force"],
    {
      cwd: process.cwd(),
      stdio: "pipe",
      shell: process.platform === "win32",
    }
  );
}

let contractUrl = "";
let invitationUrl = "";

test.describe.serial("invitation acceptance and MEMBER permission boundaries", () => {
  test("owner signs up and logs in", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("Perm E2E Owner");
    await page.getByLabel("회사명").fill("Perm E2E Co");
    await page.getByLabel("이메일").fill(ownerEmail);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);

    await logIn(page, ownerEmail);
  });

  test("owner invites a MEMBER and gets a shareable invitation link", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/members");

    await page.getByLabel("이메일").fill(memberEmail);
    await page.getByRole("button", { name: "초대 보내기" }).click();

    const linkInput = page.getByLabel("생성된 초대 링크");
    await expect(linkInput).toBeVisible();
    invitationUrl = await linkInput.inputValue();
    expect(invitationUrl).toContain("/invitations/");

    await expect(page.getByText(memberEmail)).toBeVisible();
  });

  test("the invited user signs up through the invitation link and accepts", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(invitationUrl);

    await expect(page.getByText(memberEmail)).toBeVisible();
    await page.getByLabel("이름").fill("Perm E2E Member");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입하고 초대 수락" }).click();

    await page.waitForURL(/\/login/);
    await expect(page.getByText("가입 및 초대 수락이 완료되었습니다.")).toBeVisible();
  });

  test("MEMBER logs in, creates a contract, and edits it", async ({ page }) => {
    await logIn(page, memberEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    contractUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: contractTitle })).toBeVisible();

    await page.getByRole("button", { name: "수정" }).click();
    await page.waitForURL(/\/edit$/);
    const updatedTitle = `${contractTitle} (수정됨)`;
    await page.getByLabel("계약명 *").fill(updatedTitle);
    await page.getByRole("button", { name: "수정 저장" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();
  });

  test("MEMBER cannot delete the contract or an uploaded file (buttons are absent)", async ({
    page,
  }) => {
    await logIn(page, memberEmail);
    await page.goto(contractUrl);

    // The contract-level delete button is OWNER-only.
    await expect(page.getByRole("button", { name: "삭제" })).toHaveCount(0);

    await page.setInputFiles("#contract-file", {
      name: "member-upload.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n%member upload test\n1 0 obj\n", "latin1"),
    });
    await page.getByRole("button", { name: "업로드" }).click();
    // The filename now also appears in the "AI 및 문서 추출" table added in
    // Phase 6, so this is no longer a unique match on the page.
    await expect(page.getByText("member-upload.pdf").first()).toBeVisible();

    // File-row delete button is also OWNER-only.
    const fileRow = page.getByRole("row").filter({ hasText: "member-upload.pdf" });
    await expect(fileRow.getByRole("button", { name: "삭제" })).toHaveCount(0);
  });

  test("MEMBER is blocked from viewing audit logs", async ({ page }) => {
    await logIn(page, memberEmail);
    await page.goto("/settings/audit-logs");
    await expect(page.getByText("OWNER만 감사 로그를 조회할 수 있습니다.")).toBeVisible();
  });

  test("owner changes the MEMBER's role and changes it back", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/members");

    const memberRow = page.getByRole("row").filter({ hasText: memberEmail });
    await memberRow.getByRole("combobox", { name: "역할 변경" }).click();
    await page.getByRole("option", { name: "OWNER", exact: true }).click();
    await expect(page.getByText("역할을 변경했습니다.")).toBeVisible();

    const promotedRow = page.getByRole("row").filter({ hasText: memberEmail });
    await promotedRow.getByRole("combobox", { name: "역할 변경" }).click();
    await page.getByRole("option", { name: "MEMBER", exact: true }).click();
    await expect(page.getByText("역할을 변경했습니다.")).toBeVisible();
  });

  test("owner can view audit logs and sees recent activity", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/audit-logs");
    // Two role-change entries exist (promote then revert) - just confirm
    // at least one is visible.
    await expect(page.getByText("MEMBER_ROLE_CHANGED").first()).toBeVisible();
  });

  test("owner removes the MEMBER from the organization", async ({ page }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/members");

    const memberRow = page.getByRole("row").filter({ hasText: memberEmail });
    await memberRow.getByRole("button", { name: "제거" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "제거" }).click();
    await expect(page.getByText("구성원을 제거했습니다.")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: memberEmail })).toHaveCount(0);
  });

  test("the last remaining OWNER has no self role-change or self-removal controls", async ({
    page,
  }) => {
    await logIn(page, ownerEmail);
    await page.goto("/settings/members");

    const ownRow = page.getByRole("row").filter({ hasText: ownerEmail });
    await expect(ownRow.getByRole("combobox", { name: "역할 변경" })).toHaveCount(0);
    await expect(ownRow.getByRole("button", { name: "제거" })).toHaveCount(0);
  });

  test("owner sees a generated notification and marks it read", async ({ page }) => {
    await logIn(page, ownerEmail);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(notificationContractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByLabel("종료일").fill(kstDateInputValue(7));
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);

    runNotificationGenerator();

    await page.goto("/notifications");
    await expect(page.getByText(notificationContractTitle).first()).toBeVisible();

    // NotificationItem renders one div.border-b per notification - scoping
    // to it disambiguates from the page's other elements.
    const notificationRow = page.locator("div.border-b").filter({ hasText: notificationContractTitle });
    await notificationRow.getByRole("button", { name: "읽음으로 표시" }).click();
    await expect(page.getByText("읽음으로 표시했습니다.")).toBeVisible();
  });
});
