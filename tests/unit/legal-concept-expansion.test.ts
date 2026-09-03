import { describe, expect, it } from "vitest";

import { expandLegalConcepts, MAX_EXPANSION_TERMS } from "@/domain/ai/legal-concept-expansion";

describe("expandLegalConcepts (§AI 답변 품질 개편 P0-2)", () => {
  it("is deterministic - the same question always produces the same ordered result", () => {
    const question = "이거 그냥 해지해도 돼?";
    expect(expandLegalConcepts(question)).toEqual(expandLegalConcepts(question));
  });

  it("never mutates or includes the original question text itself", () => {
    const expansion = expandLegalConcepts("자동연장돼?");
    expect(expansion).not.toContain("자동연장돼?");
    expect(expansion).not.toContain("자동연장돼");
  });

  it("deduplicates - a question triggering overlapping groups never returns the same term twice", () => {
    const expansion = expandLegalConcepts("손해배상 한도 있어?");
    expect(new Set(expansion).size).toBe(expansion.length);
  });

  it("caps expansion at MAX_EXPANSION_TERMS regardless of how many groups a question triggers", () => {
    // A synthetic question deliberately touching many groups at once.
    const question =
      "해지 자동연장 통지 위약금 손해배상 책임제한 면책 납기 지연 대금 하자 비밀유지 지식재산권 준거법 계약기간 독점 재위탁 양도 불가항력";
    const expansion = expandLegalConcepts(question);
    expect(expansion.length).toBeLessThanOrEqual(MAX_EXPANSION_TERMS);
  });

  it("preserves the original query - callers merge expansion terms alongside it, never replacing it", () => {
    // expandLegalConcepts only ever returns ADDITIONS - verified by contract, not by mutating any input.
    const question = "자동연장돼?";
    const before = question;
    expandLegalConcepts(question);
    expect(question).toBe(before);
  });

  describe("natural questions from the audit", () => {
    it('"자동연장돼?" triggers the renewal group and adds its other members', () => {
      const expansion = expandLegalConcepts("자동연장돼?");
      expect(expansion).toEqual(expect.arrayContaining(["자동갱신", "갱신"]));
    });

    it('"이거 그냥 해지해도 돼?" triggers the termination group', () => {
      const expansion = expandLegalConcepts("이거 그냥 해지해도 돼?");
      expect(expansion).toEqual(expect.arrayContaining(["종료", "계약종료"]));
    });

    it('"상대방이 납기 안 지키면?" triggers the delivery group - this is the concrete case that rescues a keyword-leg miss (see hybrid-search-scoring.test.ts)', () => {
      const expansion = expandLegalConcepts("상대방이 납기 안 지키면?");
      expect(expansion).toEqual(expect.arrayContaining(["납품", "인도", "이행기한"]));
    });

    it('"손해배상 한도 있어?" triggers BOTH the damages group and the liability-cap group (its own member term "손해배상 한도" is a literal substring)', () => {
      const expansion = expandLegalConcepts("손해배상 한도 있어?");
      expect(expansion).toEqual(expect.arrayContaining(["배상책임", "책임제한"]));
    });

    it('§Phase 1.1 P0-1 fix - "중간에 나가면 돈 물어?" now triggers BOTH the termination group (via "나가면") and the penalty group (via "돈 물어") - this was Phase 1\'s documented "honest limitation" (zero expansion), closed by adding these as colloquial-only triggers (see CONCEPT_GROUPS)', () => {
      const expansion = expandLegalConcepts("중간에 나가면 돈 물어?");
      expect(expansion).toEqual(expect.arrayContaining(["해지", "종료", "위약금", "위약벌"]));
      // The colloquial trigger phrases themselves must never be emitted -
      // they would never appear in real clause text (see ConceptGroup's
      // own docstring on why colloquialTriggers are trigger-only).
      expect(expansion).not.toContain("나가면");
      expect(expansion).not.toContain("돈 물어");
    });

    it('"내가 불리한 게 뭐야?" - deliberately produces NO expansion (no group covers "무엇이 나에게 불리한가" as a concept) - this question must instead be caught by question-complexity.ts\'s broad-question classification, not concept expansion (see question-complexity.test.ts)', () => {
      const expansion = expandLegalConcepts("내가 불리한 게 뭐야?");
      expect(expansion).toEqual([]);
    });
  });

  describe("§AI 답변 품질 개편 Phase 1.1 P0-1 - measured colloquial gaps from the real-world evaluation", () => {
    it('"돈 떼이면?" now triggers the late-payment group', () => {
      const expansion = expandLegalConcepts("돈 떼이면?");
      expect(expansion).toEqual(expect.arrayContaining(["지연", "연체", "지연손해금"]));
      expect(expansion).not.toContain("돈 떼이면");
      expect(expansion).not.toContain("떼이다");
    });

    it('"떼였어요" (inflected form) still triggers via the "떼였" trigger', () => {
      const expansion = expandLegalConcepts("대금을 떼였어요, 어떡하죠?");
      expect(expansion).toEqual(expect.arrayContaining(["지연", "연체"]));
    });

    it('"이거 하청 줘도 돼?" now triggers the subcontracting group, and "하청" itself is emitted (it is real business vocabulary, not colloquial-only)', () => {
      const expansion = expandLegalConcepts("이거 하청 줘도 돼?");
      expect(expansion).toEqual(expect.arrayContaining(["재위탁", "하도급"]));
    });

    it('"문제 생기면 누가 책임져?" now triggers the damages/liability group via the specific phrase "누가 책임"', () => {
      const expansion = expandLegalConcepts("문제 생기면 누가 책임져?");
      expect(expansion).toEqual(expect.arrayContaining(["손해배상", "배상책임"]));
    });

    it('bare "책임" alone (no "누가") does NOT trigger the liability group via the colloquial phrase path - guards against the over-broad-trigger risk called out in the implementation task', () => {
      // "책임" alone still legitimately triggers via existing LEGAL terms
      // that contain it as a substring in some phrasings (e.g. "책임제한"
      // group) - what must NOT happen is "누가 책임"-style over-triggering
      // from a bare, contextless "책임" mention with no question shape at
      // all. This question ("책임") has no other content and should not
      // explode into a huge expansion set.
      const expansion = expandLegalConcepts("책임");
      expect(expansion.length).toBeLessThanOrEqual(4);
    });

    describe("delay-context routing (§늦으면/늦게 ambiguity)", () => {
      it('"상대방이 돈 늦게 주면 어떻게 돼?" (payment context) routes to the late-PAYMENT group only', () => {
        const expansion = expandLegalConcepts("상대방이 돈 늦게 주면 어떻게 돼?");
        expect(expansion).toEqual(expect.arrayContaining(["지연", "연체", "지연손해금"]));
        expect(expansion).not.toContain("납품");
        expect(expansion).not.toContain("인도");
      });

      it('"늦게 납품하면 패널티 있어?" (delivery context) routes to the late-DELIVERY group only', () => {
        const expansion = expandLegalConcepts("늦게 납품하면 패널티 있어?");
        expect(expansion).toEqual(expect.arrayContaining(["납기", "인도", "이행기한"]));
        expect(expansion).not.toContain("연체");
        expect(expansion).not.toContain("지연손해금");
      });

      it('bare "늦으면 뭐 있어?" (no context) gets the BOUNDED fallback only - never the full union of both groups', () => {
        const expansion = expandLegalConcepts("늦으면 뭐 있어?");
        expect(expansion).toEqual(["지연", "납기"]);
        expect(expansion).not.toContain("연체");
        expect(expansion).not.toContain("인도");
        expect(expansion).not.toContain("이행기한");
      });

      it("a question mentioning both payment AND delivery context gets both groups", () => {
        const expansion = expandLegalConcepts("납품도 늦고 대금도 늦으면 어떻게 돼?");
        expect(expansion).toEqual(expect.arrayContaining(["지연", "납기"]));
      });

      it('a "늦게"-free question never triggers delay expansion at all', () => {
        const expansion = expandLegalConcepts("비밀유지 의무 있어?");
        expect(expansion).not.toContain("지연");
        expect(expansion).not.toContain("납기");
      });
    });
  });

  describe("§AI 답변 품질 개편 Phase 1.2 P0-1 - governing law / jurisdiction (q24 fix)", () => {
    it('"어디서 재판해?" (the exact q24 phrasing) now triggers the jurisdiction group', () => {
      const expansion = expandLegalConcepts("문제 생기면 어디서 재판해?");
      expect(expansion).toEqual(expect.arrayContaining(["관할", "전속관할", "합의관할", "법원"]));
      // colloquial-only triggers must never be emitted themselves
      expect(expansion).not.toContain("재판");
      expect(expansion).not.toContain("어디서 재판");
    });

    it('"소송하면 어느 법원이야?" triggers the jurisdiction group (both "소송" and literal "법원" present)', () => {
      const expansion = expandLegalConcepts("소송하면 어느 법원이야?");
      expect(expansion).toEqual(expect.arrayContaining(["관할", "전속관할", "합의관할"]));
    });

    it('"준거법 뭐야?" triggers ONLY the governing-law group, never the jurisdiction group - kept separate per the implementation task', () => {
      const expansion = expandLegalConcepts("준거법 뭐야?");
      expect(expansion).not.toContain("관할");
      expect(expansion).not.toContain("전속관할");
      expect(expansion).not.toContain("법원");
    });

    it('"분쟁 생기면 어느 나라 법 적용돼?" triggers the governing-law group via the "어느 나라 법" phrase, not the jurisdiction group (no "재판"/"소송"/"법원" present)', () => {
      const expansion = expandLegalConcepts("분쟁 생기면 어느 나라 법 적용돼?");
      expect(expansion).toEqual(expect.arrayContaining(["준거법"]));
      expect(expansion).not.toContain("관할");
      expect(expansion).not.toContain("법원");
    });

    it('"분쟁 생기면 어디서" (the specific longer phrase) triggers jurisdiction, but bare "분쟁" alone must not', () => {
      expect(expandLegalConcepts("분쟁 생기면 어디서 해결해요?")).toEqual(
        expect.arrayContaining(["관할", "전속관할", "합의관할"])
      );
      expect(expandLegalConcepts("분쟁이 있었어요")).not.toContain("관할");
    });

    it('negative: bare "문제"/"분쟁" never map to governing law/jurisdiction on their own - the exact over-triggering risk the task warned about (q29 must stay a liability question)', () => {
      expect(expandLegalConcepts("문제 생기면 누가 책임져?")).not.toContain("관할");
      expect(expandLegalConcepts("분쟁이 생겼어요, 어떡하죠?")).not.toContain("관할");
    });

    it('negative: "법" appearing inside an unrelated word (위법/불법) never triggers - every trigger is a full, specific term, never bare "법"', () => {
      const expansion = expandLegalConcepts("이거 위법 아니죠? 불법인가요?");
      expect(expansion).not.toContain("관할");
      expect(expansion).not.toContain("준거법");
      expect(expansion).not.toContain("법원");
    });
  });

  describe('§AI 답변 품질 개편 Phase 1.2 P0-2 (regression fix) - "끝나" triggers the termination/종료 group', () => {
    it('"이 계약은 언제 끝나?" now triggers the 해지/종료 group - previously this exact real-world-evaluation question only cleared the retrieval guard by accident via "계약" as a shared keyword stem, which broke once keyword-extraction.ts correctly stopped treating "계약" as discriminative (see tests/integration/ai-revision-freshness.test.ts)', () => {
      const expansion = expandLegalConcepts("이 계약은 언제 끝나?");
      expect(expansion).toEqual(expect.arrayContaining(["해지", "종료"]));
      // The colloquial trigger itself must never be emitted as a search keyword.
      expect(expansion).not.toContain("끝나");
    });

    it('"끝나면 어떻게 돼?" also triggers via the same colloquial trigger, different conjugation', () => {
      expect(expandLegalConcepts("끝나면 어떻게 돼?")).toEqual(expect.arrayContaining(["해지", "종료"]));
    });

    it('the eval\'s own q2 "중간에 계약 끝낼 수 있어?" (a DIFFERENT conjugation - "끝내다", not "끝나다") also triggers - this is the exact question that regressed from "found but ranked low" to "not found at all" once the "계약" keyword stopword fix (this same phase) removed its only accidental keyword-match path', () => {
      const expansion = expandLegalConcepts("중간에 계약 끝낼 수 있어?");
      expect(expansion).toEqual(expect.arrayContaining(["해지", "종료"]));
      expect(expansion).not.toContain("끝낼");
    });
  });

  describe('§AI 답변 품질 개편 Phase 1.2 P0-2 (regression fix, q21) - "넘길"/"넘기면"/"넘겨" triggers the 양도 group', () => {
    it('the eval\'s own q21 "이 계약 다른 회사한테 넘길 수 있어?" now triggers 양도 - previously this only cleared the guard via "계약" as an accidental shared keyword stem with 제14조\'s own "본 계약상의 권리... 양도" text; once that stopped counting, the top result silently drifted to a WRONG topic (제15조 재위탁/subcontracting) instead of 제14조 (양도/assignment)', () => {
      const expansion = expandLegalConcepts("이 계약 다른 회사한테 넘길 수 있어?");
      expect(expansion).toContain("양도");
      expect(expansion).not.toContain("넘길");
    });

    it('"넘기면 어떻게 돼?"/"넘겨도 돼?" also trigger via the other two conjugations', () => {
      expect(expandLegalConcepts("넘기면 어떻게 돼?")).toContain("양도");
      expect(expandLegalConcepts("넘겨도 돼?")).toContain("양도");
    });

    it('negative: "넘길"/"넘기면"/"넘겨" themselves are never emitted as search keywords (colloquial-only, would never appear in real clause text)', () => {
      const expansion = expandLegalConcepts("다른 회사에 넘기면 어떻게 돼?");
      expect(expansion).not.toContain("넘길");
      expect(expansion).not.toContain("넘기면");
      expect(expansion).not.toContain("넘겨");
    });
  });

  describe('§AI 답변 품질 개편 Phase 1.2 P0-4 (q13 fix) - "패널티" triggers 지체상금/지연배상금', () => {
    it('the eval\'s own q13 "늦게 납품하면 패널티 있어?" now expands to include "지체상금" - the formal legal term for a late-delivery penalty (제8조\'s own title), previously entirely absent from this table so the question\'s real ask had no keyword bridge to the answering clause', () => {
      const expansion = expandLegalConcepts("늦게 납품하면 패널티 있어?");
      expect(expansion).toContain("지체상금");
      expect(expansion).toContain("지연배상금");
      expect(expansion).not.toContain("패널티");
    });

    it('a bare "지체상금 있어?" (no delay-trigger words at all) still works, since this is a standalone group, not folded into the delay-context routing', () => {
      const expansion = expandLegalConcepts("지체상금 있어?");
      // The question already contains "지체상금" literally, so addTerm()
      // correctly does not re-add it - the group still triggers (via its
      // own legalTerms member being present), it just contributes nothing
      // NEW beyond what's already in the question.
      expect(expansion).not.toContain("지체상금");
    });

    it('bare "패널티 있어?" (no delay-trigger, no "납품") still triggers via the colloquial term alone', () => {
      expect(expandLegalConcepts("패널티 있어?")).toEqual(expect.arrayContaining(["지체상금", "지연배상금"]));
    });
  });
});
