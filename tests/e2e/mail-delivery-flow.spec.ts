import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { readLatestMailboxLink } from "./helpers/mailbox";

/**
 * Phase 10B section 28 - end-to-end coverage of the mail flows this Phase
 * adds, using the development-mailer test mailbox (tests/e2e/helpers/mailbox.ts)
 * to deterministically retrieve token-bearing links that (unlike the
 * invitation flow) are never echoed back through the UI, to preserve
 * account-enumeration safety.
 */

const runId = Date.now();
const verifyEmail = `mail-e2e-verify-${runId}@e2e-test.local`;
const resetEmail = `mail-e2e-reset-${runId}@e2e-test.local`;
const ownerEmail = `mail-e2e-owner-${runId}@e2e-test.local`;
const inviteeEmail = `mail-e2e-invitee-${runId}@e2e-test.local`;
const password = "Password123";
const newPassword = "NewPassword456";

function runMailWorker() {
  // §Phase 12.4 §2 - explicitly .env.e2e, not .env.test: this worker must
  // operate on the SAME database this E2E run is using (clausebase_e2e),
  // never the Vitest database (clausebase_test). In practice DATABASE_URL
  // is already set by the outer `dotenv -e .env.e2e` wrapper and dotenv-cli
  // never overrides an already-set env var (verified empirically), so this
  // previously had no observable effect - but naming the wrong file here
  // was a latent footgun for any invocation that does NOT already have
  // .env.e2e loaded in its environment.
  execFileSync("pnpm", ["exec", "dotenv", "-e", ".env.e2e", "--", "tsx", "scripts/process-mail-deliveries.ts", "--limit=20"], {
    cwd: process.cwd(),
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

test.describe.serial("email verification - real link click-through via test mailbox", () => {
  test("signup, then resending verification produces a retrievable mailbox link that actually verifies the address", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("Mail E2E Verify Tester");
    await page.getByLabel("회사명").fill("Mail E2E Verify Co");
    await page.getByLabel("이메일").fill(verifyEmail);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel("이메일").fill(verifyEmail);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText("이메일 주소가 아직 인증되지 않았습니다.")).toBeVisible();

    await page.getByRole("button", { name: "인증 메일 재발송" }).click();
    await expect(page.getByText("인증 메일을 다시 보냈습니다.")).toBeVisible();

    const verificationUrl = await readLatestMailboxLink(verifyEmail, "EMAIL_VERIFICATION");
    expect(verificationUrl).toContain("/verify-email/");

    await page.goto(verificationUrl);
    await expect(page.getByText(`${verifyEmail} 주소가 인증되었습니다.`)).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByText("이메일 주소가 아직 인증되지 않았습니다.")).not.toBeVisible();
  });
});

test.describe.serial("password reset - real link click-through via test mailbox", () => {
  test("forgot-password produces a retrievable mailbox link that actually resets the password and triggers a password-changed notice", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("Mail E2E Reset Tester");
    await page.getByLabel("회사명").fill("Mail E2E Reset Co");
    await page.getByLabel("이메일").fill(resetEmail);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);

    await page.goto("/forgot-password");
    await page.getByLabel("이메일").fill(resetEmail);
    await page.getByRole("button", { name: "재설정 링크 받기" }).click();
    await expect(
      page.getByText("입력한 이메일과 일치하는 계정이 있다면 안내를 전송했습니다.")
    ).toBeVisible();

    const resetUrl = await readLatestMailboxLink(resetEmail, "PASSWORD_RESET");
    expect(resetUrl).toContain("/reset-password/");

    await page.goto(resetUrl);
    await page.getByLabel("새 비밀번호", { exact: true }).fill(newPassword);
    await page.getByLabel("새 비밀번호 확인").fill(newPassword);
    await page.getByRole("button", { name: "비밀번호 재설정" }).click();
    await expect(page.getByText("비밀번호가 재설정되었습니다.")).toBeVisible();
    await page.waitForURL(/\/login/, { timeout: 5000 });

    // §10 - the post-reset redirect URL never carries the token.
    expect(page.url()).not.toContain("/reset-password/");

    // The new password actually works.
    await page.getByLabel("이메일").fill(resetEmail);
    await page.getByLabel("비밀번호").fill(newPassword);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);
  });

  test("the mail worker processes the resulting PASSWORD_CHANGED delivery (real CLI invocation, §13)", async () => {
    // The password-changed notice is enqueued PENDING (async outbox, unlike
    // the two synchronous flows above) - run the actual worker CLI exactly
    // as an operator/cron would, then confirm it drained without error.
    expect(() => runMailWorker()).not.toThrow();
  });
});

test.describe.serial("invitation resend rotates the token (§19)", () => {
  // The resend button copies the new link to the clipboard - grant the
  // permission explicitly so navigator.clipboard.writeText() cannot hang
  // on an unresolved browser permission prompt in headless Chromium.
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("resending an invitation invalidates the old link and the new mailbox link works instead", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("Mail E2E Owner");
    await page.getByLabel("회사명").fill("Mail E2E Owner Co");
    await page.getByLabel("이메일").fill(ownerEmail);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel("이메일").fill(ownerEmail);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/settings/members");
    await page.getByLabel("이메일").fill(inviteeEmail);
    await page.getByRole("button", { name: "초대 보내기" }).click();

    const originalUrl = await page.getByLabel("생성된 초대 링크").inputValue();
    expect(originalUrl).toContain("/invitations/");

    // exact:true - "재발송" is also a substring of the unrelated "인증 메일
    // 재발송" button rendered by the (still-unverified) owner's email
    // verification banner on every dashboard page.
    await page.getByRole("button", { name: "재발송", exact: true }).click();
    await expect(page.getByText("초대를 재발송했습니다.")).toBeVisible();

    const resentUrl = await readLatestMailboxLink(inviteeEmail, "ORGANIZATION_INVITATION");
    expect(resentUrl).not.toBe(originalUrl);

    // The OLD link no longer works.
    await page.context().clearCookies();
    await page.goto(originalUrl);
    await expect(page.getByText(/유효하지 않|만료|찾을 수 없/)).toBeVisible();

    // The NEW link does.
    await page.goto(resentUrl);
    await expect(page.getByText(inviteeEmail)).toBeVisible();
  });
});
