import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * §Phase 12.4 §13 - lightweight, dependency-free secret scan used as
 * `release:verify`'s step 1, and re-run immediately before every commit
 * (§15). Deliberately NOT a replacement for the gitleaks-action CI job
 * (.github/workflows/ci.yml's separate `secret-scan` job, entropy-based
 * and far more thorough) - gitleaks is a GitHub Action, not a local CLI
 * guaranteed to be installed on every dev machine, so this exists as a
 * fast, zero-dependency, pattern-based first line of defense that can run
 * anywhere `pnpm` runs. Scans git-TRACKED files only (never node_modules/
 * .next/build output), and explicitly allow-lists this codebase's own
 * documented placeholder values (development-only-password,
 * ci-only-secret-not-for-production-use, *.example files) so it does not
 * cry wolf on every run.
 */

interface Finding {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

const ALLOWLISTED_FILE_SUFFIXES = [".example", ".md", ".lock", "pnpm-lock.yaml"];

const ALLOWLISTED_VALUE_SUBSTRINGS = [
  "development-only-password",
  "ci-only-secret-not-for-production-use",
  "e2e-only-secret-not-for-production-use",
  "changeme",
  "placeholder",
  "example",
  "xxxxxxxx",
  "your-",
  "REPLACE_ME",
  // Test fixtures asserting that logging/error paths NEVER leak a secret
  // value (e.g. tests/unit/production-readiness.test.ts,
  // tests/unit/email-config.test.ts) use this marker for an intentionally
  // fake value, never a real credential.
  "super-secret",
];

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key ID", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "AWS Secret Access Key (heuristic)", regex: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/i },
  { name: "Private key header", regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
  { name: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "Postmark server token (heuristic)", regex: /postmark[_-]?(server[_-]?)?token\s*[:=]\s*['"][a-f0-9-]{20,}['"]/i },
  {
    name: "Generic high-entropy secret assignment",
    regex: /(SECRET|PASSWORD|API_KEY|APIKEY|PRIVATE_KEY|TOKEN)\s*[:=]\s*['"][A-Za-z0-9+/_-]{20,}['"]/,
  },
];

function isAllowlistedFile(file: string): boolean {
  return ALLOWLISTED_FILE_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

function isAllowlistedValue(line: string): boolean {
  const lower = line.toLowerCase();
  return ALLOWLISTED_VALUE_SUBSTRINGS.some((s) => lower.includes(s.toLowerCase()));
}

function listTrackedTextFiles(): string[] {
  const output = execSync("git ls-files", { encoding: "utf8" });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .filter((f) => !isAllowlistedFile(f));
}

function scanFile(file: string): Finding[] {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return []; // binary or unreadable - skip rather than crash the whole scan.
  }
  const findings: Finding[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (isAllowlistedValue(line)) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({ file, line: i + 1, pattern: pattern.name, excerpt: line.trim().slice(0, 100) });
      }
    }
  }
  return findings;
}

async function main(): Promise<void> {
  console.log("[secret-scan] git-tracked 파일 대상 패턴 기반 시크릿 스캔 시작...");
  const files = listTrackedTextFiles();
  const allFindings: Finding[] = [];
  for (const file of files) {
    allFindings.push(...scanFile(file));
  }

  if (allFindings.length === 0) {
    console.log(`[secret-scan] ${files.length}개 파일 검사 완료 - 의심스러운 패턴 없음.`);
    return;
  }

  console.error(`[secret-scan] 의심스러운 패턴 ${allFindings.length}건 발견:`);
  for (const finding of allFindings) {
    console.error(`  - ${finding.file}:${finding.line} [${finding.pattern}] ${finding.excerpt}`);
  }
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[secret-scan] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
