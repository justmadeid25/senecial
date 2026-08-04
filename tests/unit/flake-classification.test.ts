import { describe, expect, it } from "vitest";

import { classifyFailure } from "@/domain/testing/flake-classification";

describe("classifyFailure (Phase 12.2 §8)", () => {
  it("classifies a Postgres unique-constraint violation as TEST_DATA_COLLISION", () => {
    expect(classifyFailure('duplicate key value violates unique constraint "users_email_key"').category).toBe(
      "TEST_DATA_COLLISION"
    );
  });

  it("classifies a Prisma P2002 error as TEST_DATA_COLLISION", () => {
    expect(classifyFailure("Unique constraint failed on the fields (P2002)").category).toBe("TEST_DATA_COLLISION");
  });

  it("classifies a deadlock as DATABASE_LOCK", () => {
    expect(classifyFailure("error: deadlock detected").category).toBe("DATABASE_LOCK");
  });

  it("classifies ECONNREFUSED as SERVER_STARTUP", () => {
    expect(classifyFailure("connect ECONNREFUSED 127.0.0.1:3100").category).toBe("SERVER_STARTUP");
  });

  it("classifies a Next.js dev-server worker crash as NEXT_COMPILE - a real pattern observed during Phase 12.2 verification", () => {
    expect(classifyFailure("Error: Jest worker encountered 2 child process exceptions, exceeding retry limit").category).toBe(
      "NEXT_COMPILE"
    );
  });

  it("classifies a strict-mode selector violation as SELECTOR_AMBIGUITY", () => {
    expect(classifyFailure("strict mode violation: getByText resolved to 2 elements").category).toBe("SELECTOR_AMBIGUITY");
  });

  it("classifies a worker CLI reference as WORKER_CLI_TIMEOUT", () => {
    expect(classifyFailure("Timeout waiting for processNextExtractionJob to complete").category).toBe("WORKER_CLI_TIMEOUT");
  });

  it("classifies ENOENT as FILE_IO", () => {
    expect(classifyFailure("ENOENT: no such file or directory, open 'tmp/e2e-storage/x/file.pdf'").category).toBe("FILE_IO");
  });

  it("falls back to a generic timeout message as NETWORK_TIMEOUT when nothing more specific matches", () => {
    expect(classifyFailure("Test timeout of 30000ms exceeded.").category).toBe("NETWORK_TIMEOUT");
  });

  it("§8 - never forces an unrecognized message into a category - returns UNKNOWN instead", () => {
    const result = classifyFailure("some completely novel error text nobody has seen before xyz123");
    expect(result.category).toBe("UNKNOWN");
    expect(result.rationale).toContain("근거 없이 분류하지 않음");
  });

  it("prefers a more specific rule over the generic timeout pattern when both could match", () => {
    // Contains BOTH a generic timeout phrase AND a specific ECONNREFUSED signal - the specific one must win.
    const message = "Test timeout of 30000ms exceeded. connect ECONNREFUSED 127.0.0.1:3100";
    expect(classifyFailure(message).category).toBe("SERVER_STARTUP");
  });
});
