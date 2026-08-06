import { describe, expect, it } from "vitest";

import type { Citation } from "@/domain/ai/citation";
import { assertEveryParagraphHasCitation } from "@/domain/ai/citation-required";
import { buildPromptMessages, buildSystemPrompt, buildUserPrompt } from "@/domain/ai/prompt-builder";
import { DeterministicDevelopmentLlmProvider } from "@/server/services/ai/deterministic-development-llm-provider";

const CITATIONS: Citation[] = [
  {
    contractClauseId: "c1",
    contractId: "k1",
    contractTitle: "테스트 계약",
    clauseReference: "제1조",
    evidenceText: "계약 해지는 서면으로 통지해야 한다.",
    score: 0.9,
  },
  {
    contractClauseId: "c2",
    contractId: "k1",
    contractTitle: "테스트 계약",
    clauseReference: "제2조",
    evidenceText: "비밀유지 의무는 계약 종료 후에도 유지된다.",
    score: 0.8,
  },
];

describe("prompt-builder (Phase 12 Part E)", () => {
  it("builds a system+user message pair, never mixing the two", () => {
    const messages = buildPromptMessages("계약 해지는 어떻게 하나요?", CITATIONS);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });

  it("the user prompt embeds every citation as a parseable block", () => {
    const prompt = buildUserPrompt("질문", CITATIONS);
    expect(prompt).toContain("[CITATION 1]");
    expect(prompt).toContain("제1조");
    expect(prompt).toContain("[CITATION 2]");
    expect(prompt).toContain("제2조");
  });

  it("the system prompt states the never-modify-contracts rule and hides itself from output by construction (it is a separate message role)", () => {
    const system = buildSystemPrompt();
    expect(system).toContain("절대 수정하지 않습니다");
  });

  it("with zero citations, the user prompt instructs the model to never guess", () => {
    const prompt = buildUserPrompt("질문", []);
    expect(prompt).toContain("절대 추측하지 말고");
  });
});

describe("DeterministicDevelopmentLlmProvider (Phase 12 Part D/F - real, not a placeholder)", () => {
  const provider = new DeterministicDevelopmentLlmProvider();

  it("generateCompletion produces an answer where every paragraph passes citation-required enforcement", async () => {
    const messages = buildPromptMessages("계약 해지 방법과 비밀유지 의무를 알려주세요.", CITATIONS);
    const result = await provider.generateCompletion(messages);

    expect(result.text.length).toBeGreaterThan(0);
    expect(() => assertEveryParagraphHasCitation(result.text, CITATIONS)).not.toThrow();
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
  });

  it("references content that was ACTUALLY in the provided citations, not fabricated text", async () => {
    const messages = buildPromptMessages("질문", CITATIONS);
    const result = await provider.generateCompletion(messages);
    expect(result.text).toContain("계약 해지는 서면으로 통지해야 한다.");
    expect(result.text).toContain("비밀유지 의무는 계약 종료 후에도 유지된다.");
  });

  it("with zero citations, answers 'don't know' with no citation markers, and citation-required correctly refuses to validate it (by design - the hallucination guard must intercept before this point)", async () => {
    const messages = buildPromptMessages("질문", []);
    const result = await provider.generateCompletion(messages);
    expect(result.text).toContain("찾지 못했습니다");
    expect(() => assertEveryParagraphHasCitation(result.text, [])).toThrow(/citation 없이는/);
  });

  it("stream yields multiple real text-delta events (not one single chunk) that concatenate to the exact same text generateCompletion returns, followed by usage and done", async () => {
    const messages = buildPromptMessages("계약 해지 방법", CITATIONS);
    const { text: fullText } = await provider.generateCompletion(messages);

    const chunks: string[] = [];
    const events: string[] = [];
    for await (const event of provider.stream(messages)) {
      events.push(event.type);
      if (event.type === "text-delta") {
        chunks.push(event.text);
      }
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(fullText);
    expect(events.at(-2)).toBe("usage");
    expect(events.at(-1)).toBe("done");
  });
});
