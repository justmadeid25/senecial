import { describe, expect, it } from "vitest";

import type { Citation } from "@/domain/ai/citation";
import { ANSWER_BLOCK_TAGS, assertEveryParagraphHasCitation } from "@/domain/ai/citation-required";
import { buildPromptMessages, buildSystemPrompt, buildUserPrompt } from "@/domain/ai/prompt-builder";
import { DeterministicDevelopmentLlmProvider } from "@/server/services/ai/deterministic-development-llm-provider";

const CITATIONS: Citation[] = [
  {
    evidenceType: "clause",
    contractClauseId: "c1",
    chunkId: null,
    contractId: "k1",
    contractTitle: "테스트 계약",
    clauseReference: "제1조",
    evidenceText: "계약 해지는 서면으로 통지해야 한다.",
    score: 0.9,
  },
  {
    evidenceType: "clause",
    contractClauseId: "c2",
    chunkId: null,
    contractId: "k1",
    contractTitle: "테스트 계약",
    clauseReference: "제2조",
    evidenceText: "비밀유지 의무는 계약 종료 후에도 유지된다.",
    score: 0.8,
  },
];

describe("prompt-builder (Phase 12 Part E)", () => {
  it("builds a system+user message pair, never mixing the two (no history = unchanged 2-message shape)", () => {
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

  describe("§AI 답변 품질 개편 P0-3 - system prompt no longer forbids a direct, useful answer", () => {
    const system = buildSystemPrompt();

    it("still forbids declaring the contract legally valid/invalid or absolutely safe/dangerous", () => {
      expect(system).toContain("법적으로 유효하다거나 무효라고");
      expect(system).toContain("절대적으로 안전하다거나 위험하다고 단정하지 마십시오");
    });

    it("still forbids inventing facts not supported by retrieved evidence", () => {
      expect(system).toContain("근거 문장 외의 내용으로 추론하지 마십시오");
    });

    it("no longer contains the old blanket 'never state a conclusion' rule", () => {
      // The old v1 wording explicitly forbade ANY safe/risk-adjacent
      // framing and told the model to present ONLY differences+evidence -
      // this is exactly what made answers read as evasive (see the audit).
      expect(system).not.toContain("기준 조항과 다른 부분, 그리고 근거만 제시하십시오");
    });

    it("explicitly REQUIRES answering yes/no-style questions directly when the evidence supports it", () => {
      expect(system).toContain("예/아니오로 답할 수 있는 질문에는 예/아니오부터 명확히 말하십시오");
    });

    it("§AI 답변 품질 개편 Phase 1.4 - the 확인사항 block is CONDITIONAL (only when it adds new practical value), never an unconditional requirement to restate the conclusion a third time", () => {
      expect(system).toContain("새로운 실무 정보");
      expect(system).toContain("확인사항 문단을 아예 쓰지 마십시오");
    });

    it("instructs the tagged answer-block structure (결론/근거/확인사항) with the citation requirement scoped to 근거 blocks only", () => {
      expect(system).toContain(ANSWER_BLOCK_TAGS.conclusion);
      expect(system).toContain(ANSWER_BLOCK_TAGS.evidence);
      expect(system).toContain(ANSWER_BLOCK_TAGS.action);
    });
  });

  describe("§AI 답변 품질 개편 Phase 1.4 - relevance discipline, party-perspective, and complexity-aware branching", () => {
    it("q7-style relevance rule: instructs the model NOT to discuss every supplied [CITATION] block, only ones that actually answer the question (the exact q7 problem - a non-payment question's answer discussing an unrelated late-delivery penalty clause that was merely retrieved alongside it)", () => {
      const system = buildSystemPrompt("focused");
      expect(system).toContain("답을 바꾸지 않는 무관한 조항은 언급하지 마십시오");
      const userPrompt = buildUserPrompt("돈 떼이면?", CITATIONS);
      expect(userPrompt).toContain("전부 답변에 인용해야 하는 것은 아닙니다");
    });

    it("states party-perspective handling (no silent assumption, no generic disclaimer) - relevant to ambiguous questions like \"내가 불리한 게 뭐야?\"", () => {
      const system = buildSystemPrompt("comprehensive");
      expect(system).toContain("조용히 한쪽 당사자(발주자든 수행자든)라고 가정하지 마십시오");
      expect(system).not.toContain("법률 자문을 받으시기 바랍니다");
    });

    it("§AI 답변 품질 개편 Phase 1.4.1 - known role is used directly (no re-asking), unknown role is never silently defaulted to 발주자 - the OLD example text (\"발주자 기준으로 답변드리면...\") was itself a plausible anchoring bias and is removed", () => {
      const system = buildSystemPrompt("focused");
      expect(system).toContain("이미 확인된 경우, 그 당사자 기준으로 명확하게 답하십시오");
      expect(system).not.toContain("발주자 기준으로 답변드리면");
    });

    it("§AI 답변 품질 개편 Phase 1.4.1 - forbids inferring a broader legal consequence than the cited provision literally states (the q16 \"해지가 불가능\" overreach)", () => {
      const system = buildSystemPrompt("focused");
      expect(system).toContain("문자 그대로 말하는 것보다 넓은 법적 결과를 추론하지 마십시오");
      expect(system).toContain("중도해지권");
    });

    it("§AI 답변 품질 개편 Phase 1.4.1 - relevance rule explicitly names the cross-party-pollution pattern (q7: a non-payment question must not pull in the OTHER party's unrelated breach)", () => {
      const system = buildSystemPrompt("focused");
      expect(system).toContain("반대 당사자의 다른 종류의 위반");
    });

    it("§AI 답변 품질 개편 Phase 1.4.1 - states an explicit instruction priority order (issue first, then party, then inference scope)", () => {
      const system = buildSystemPrompt("focused");
      expect(system).toContain("우선순위 (지시가 서로 부딪히면 이 순서를 따르십시오)");
      const priorityIndex = system.indexOf("우선순위");
      const relevanceIndex = system.indexOf("관련성");
      const partyIndex = system.indexOf("당사자 관점");
      const inferenceIndex = system.indexOf("추론 범위 제한");
      expect(priorityIndex).toBeGreaterThan(-1);
      expect(priorityIndex).toBeLessThan(relevanceIndex);
      expect(relevanceIndex).toBeLessThan(partyIndex);
      expect(partyIndex).toBeLessThan(inferenceIndex);
    });

    describe("§AI 답변 품질 개편 Phase 1.4.2 - q14 broad-answer prioritization (comprehensive-only)", () => {
      it("caps unrequested broad review at ~3-5 items, only lifted by an explicit exhaustive-review request - comprehensive-only, absent from focused", () => {
        const comprehensive = buildSystemPrompt("comprehensive");
        const focused = buildSystemPrompt("focused");
        expect(comprehensive).toContain("가장 중요한 약 3~5개만 선별하십시오");
        expect(comprehensive).toContain("전수 검토를 요청한 경우가 아니라면 이 상한을 넘기지 마십시오");
        expect(focused).not.toContain("가장 중요한 약 3~5개만 선별하십시오");
      });

      it("explicitly names ordinary/boilerplate provisions (confidentiality, notice procedure, assignment restriction) that must NOT be flagged merely for existing, and requires concrete evidence of unusualness", () => {
        const system = buildSystemPrompt("comprehensive");
        expect(system).toContain("비밀유지 의무, 통지 절차, 권리·의무 양도 제한");
        expect(system).toContain("단지 그 조항이 존재한다는 이유만으로");
        expect(system).toContain("구체적인 이례성");
      });

      it("requires a short headline+key-detail+citation per item and explicitly forbids restating items in the concluding paragraph, and (§Phase 1.4.4) forbids a 확인사항 block outright in this mode", () => {
        const system = buildSystemPrompt("comprehensive");
        expect(system).toContain("무엇이고 왜 중요한지 한 문장");
        expect(system).toContain("이슈 제목이나 내용을 결론에서 미리 나열하거나 요약하지 마십시오");
        expect(system).toContain("확인사항 문단은 이 모드에서는 작성하지 마십시오");
      });

      it("forbids citing an unselected provision just because it was retrieved - citation count should track selected items, not retrieval breadth", () => {
        const system = buildSystemPrompt("comprehensive");
        expect(system).toContain("더 많은 조항이 검색되었다고 해서 표시(출처)를 더 많이 붙일 필요는 없습니다");
      });

      it("recognizes the broader family of broad evaluative phrasings this fix targets, not just the two originally covered", () => {
        const system = buildSystemPrompt("comprehensive");
        expect(system).toContain("눈에 띄는 조건 있어?");
        expect(system).toContain("특이한 거 있어?");
        expect(system).toContain("주의해서 볼 조항은?");
      });

      it("q7/q11/q12/q13/q16's own focused/shared rules are completely unaffected by the comprehensive-only rewrite", () => {
        const focused = buildSystemPrompt("focused");
        expect(focused).toContain("반대 당사자의 다른 종류의 위반");
        expect(focused).toContain("문자 그대로 말하는 것보다 넓은 법적 결과를 추론하지 마십시오");
        expect(focused).toContain("이미 확인된 경우, 그 당사자 기준으로 명확하게 답하십시오");
      });
    });

    it("comprehensive complexity includes exact-count and boilerplate-vs-unusual ranking guidance that focused complexity does NOT", () => {
      const comprehensive = buildSystemPrompt("comprehensive");
      const focused = buildSystemPrompt("focused");
      expect(comprehensive).toContain("정확히 그 개수만큼만");
      expect(comprehensive).toContain("이례적인 조항");
      expect(focused).not.toContain("정확히 그 개수만큼만");
    });

    it("focused complexity includes the anti-repetition conciseness guidance that comprehensive complexity does NOT", () => {
      const focused = buildSystemPrompt("focused");
      const comprehensive = buildSystemPrompt("comprehensive");
      expect(focused).toContain("같은 말을 세 번 반복하지 마십시오");
      expect(comprehensive).not.toContain("같은 말을 세 번 반복하지 마십시오");
    });

    it("buildSystemPrompt() defaults to focused when called with no argument (backward-compatible for existing callers)", () => {
      expect(buildSystemPrompt()).toEqual(buildSystemPrompt("focused"));
    });

    it("buildPromptMessages() threads complexity through to the system message and defaults to focused", () => {
      const messages = buildPromptMessages("질문", CITATIONS, [], "comprehensive");
      expect(messages[0]!.content).toEqual(buildSystemPrompt("comprehensive"));
      expect(buildPromptMessages("질문", CITATIONS)[0]!.content).toEqual(buildSystemPrompt("focused"));
    });
  });

  describe("§AI 답변 품질 개편 P0-1 - bounded conversation history in the prompt", () => {
    const history = [
      { role: "USER" as const, content: "이 계약 자동갱신돼?" },
      { role: "ASSISTANT" as const, content: "네, 자동 갱신되는 구조입니다." },
    ];

    it("inserts history turns BETWEEN the system prompt and the current user message, mapped to user/assistant roles", () => {
      const messages = buildPromptMessages("그럼 언제까지 말해야 돼?", CITATIONS, history);
      expect(messages).toHaveLength(4);
      expect(messages[0]!.role).toBe("system");
      expect(messages[1]).toEqual({ role: "user", content: "이 계약 자동갱신돼?" });
      expect(messages[2]).toEqual({ role: "assistant", content: "네, 자동 갱신되는 구조입니다." });
      expect(messages[3]!.role).toBe("user");
      expect(messages[3]!.content).toContain("그럼 언제까지 말해야 돼?");
    });

    it("history never masquerades as a system-level instruction (no 'system' role ever produced from history)", () => {
      const messages = buildPromptMessages("질문", CITATIONS, history);
      expect(messages.filter((m) => m.role === "system")).toHaveLength(1);
    });

    it("empty history array produces the exact same 2-message shape as omitting the parameter", () => {
      expect(buildPromptMessages("질문", CITATIONS, [])).toEqual(buildPromptMessages("질문", CITATIONS));
    });
  });

  describe("§AI 답변 품질 개편 Phase 1.4.1 - party-role handling via conversation history", () => {
    // §What this CAN and CANNOT prove without a real LLM call - the
    // development provider never reasons about party role at all (it just
    // echoes citation blocks mechanically), so actual model COMPLIANCE
    // with "use the known role, don't hedge on the unknown one" can only
    // be confirmed by the real-OpenAI re-evaluation this phase's own task
    // asks for afterward (see the final report). What IS deterministically
    // verifiable, and what these three tests check: (a) the system prompt
    // states both rules correctly (already covered above), and (b) the
    // history-threading MECHANISM actually delivers a role-establishing
    // prior turn into the message array the model sees, for a known role
    // in either direction - if the infrastructure didn't carry this
    // signal through, no amount of prompt wording could fix compliance.

    it("1. unknown role (no history) - the message array carries no role-establishing content at all, matching the system prompt's 'do not silently assume' rule", () => {
      const messages = buildPromptMessages("내가 불리한 게 뭐야?", CITATIONS, [], "comprehensive");
      const nonSystemContent = messages
        .filter((m) => m.role !== "system")
        .map((m) => m.content)
        .join("\n");
      expect(nonSystemContent).not.toContain("발주자");
      expect(nonSystemContent).not.toContain("수행자");
    });

    it("2. known 발주자 role - a prior conversation turn establishing the user as 발주자 is threaded into the message array BEFORE the current question, so the model has the signal available to answer from that perspective without re-asking", () => {
      const roleHistory = [
        { role: "USER" as const, content: "저는 이 계약의 발주자입니다." },
        { role: "ASSISTANT" as const, content: "네, 발주자 입장에서 안내해 드리겠습니다." },
      ];
      const messages = buildPromptMessages("내가 불리한 게 뭐야?", CITATIONS, roleHistory, "comprehensive");
      expect(messages[1]).toEqual({ role: "user", content: "저는 이 계약의 발주자입니다." });
      expect(messages[2]).toEqual({ role: "assistant", content: "네, 발주자 입장에서 안내해 드리겠습니다." });
      expect(messages.at(-1)!.content).toContain("내가 불리한 게 뭐야?");
    });

    it("3. known 수행자 role - the same mechanism works symmetrically for the other party, never hardcoded toward 발주자", () => {
      const roleHistory = [
        { role: "USER" as const, content: "저는 이 계약의 수행자 쪽이에요." },
        { role: "ASSISTANT" as const, content: "네, 수행자 입장에서 안내해 드리겠습니다." },
      ];
      const messages = buildPromptMessages("내가 불리한 게 뭐야?", CITATIONS, roleHistory, "comprehensive");
      expect(messages[1]).toEqual({ role: "user", content: "저는 이 계약의 수행자 쪽이에요." });
      expect(messages[2]).toEqual({ role: "assistant", content: "네, 수행자 입장에서 안내해 드리겠습니다." });
    });
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

  it("§AI 답변 품질 개편 P0-1 regression - with conversation history present (an EARLIER user-role message with no [CITATION] blocks at all), still uses the CURRENT turn's real citations, not the history's own citation-less question text", async () => {
    const history = [
      { role: "USER" as const, content: "이 계약 자동갱신돼?" },
      { role: "ASSISTANT" as const, content: "네, 자동 갱신되는 구조입니다." },
    ];
    const messages = buildPromptMessages("그럼 언제까지 말해야 돼?", CITATIONS, history);
    const result = await provider.generateCompletion(messages);

    expect(result.text).toContain("계약 해지는 서면으로 통지해야 한다.");
    expect(result.text).toContain("비밀유지 의무는 계약 종료 후에도 유지된다.");
    expect(result.text).not.toContain("제공된 근거가 없어 답변할 수 없습니다");
    expect(() => assertEveryParagraphHasCitation(result.text, CITATIONS)).not.toThrow();
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
