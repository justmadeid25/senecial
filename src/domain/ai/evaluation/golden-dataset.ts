/**
 * §Evaluation (Phase 12 Part L) - a small, hand-curated golden dataset:
 * fixed clause texts with a KNOWN relevant clause (or explicit "genuinely
 * unanswerable") for each question, so retrieval/answer quality can be
 * scored against ground truth rather than eyeballed. Scoped to evaluating
 * retrieval + answer quality only - document extraction/segmentation are
 * already covered by their own integration tests (extraction.test.ts,
 * clause-segmentation.test.ts), so this dataset is seeded through the
 * real end-to-end pipeline (see run-ai-evaluation.ts) but does not itself
 * attempt to stress that pipeline.
 */
export interface GoldenDatasetClause {
  /** Stable identifier for this fixture clause - never a real ContractClause.id (those are generated per run). */
  key: string;
  heading: string;
  text: string;
}

export interface GoldenDatasetQuestion {
  id: string;
  question: string;
  /** Keys into GOLDEN_DATASET_CLAUSES - empty means genuinely unanswerable from this dataset. */
  relevantClauseKeys: string[];
  /** True if the hallucination guard SHOULD refuse to answer this question. */
  expectRefusal: boolean;
}

export const GOLDEN_DATASET_CLAUSES: readonly GoldenDatasetClause[] = [
  {
    key: "TERMINATION",
    heading: "제1조(계약 해지)",
    text: "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.",
  },
  {
    key: "CONFIDENTIALITY",
    heading: "제2조(비밀유지)",
    text: "양 당사자는 본 계약과 관련하여 취득한 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.",
  },
  {
    key: "PAYMENT",
    heading: "제3조(대금지급)",
    text: "발주자는 용역 완료 후 30일 이내에 대금을 지급하여야 한다.",
  },
  {
    key: "LIABILITY",
    heading: "제4조(손해배상)",
    text: "당사자는 고의 또는 과실로 상대방에게 손해를 끼친 경우 그 손해를 배상하여야 한다.",
  },
  {
    key: "INTELLECTUAL_PROPERTY",
    heading: "제5조(지식재산권)",
    text: "본 계약의 수행 결과물에 대한 지식재산권은 발주자에게 귀속된다.",
  },
  {
    key: "DATA_PROTECTION",
    heading: "제6조(개인정보 보호)",
    text: "수탁자는 개인정보를 위탁받은 처리목적 범위 내에서만 이용하고 위탁 종료 시 즉시 파기하여야 한다.",
  },
];

export const GOLDEN_DATASET_QUESTIONS: readonly GoldenDatasetQuestion[] = [
  { id: "q1", question: "계약을 해지하려면 어떻게 해야 하나요?", relevantClauseKeys: ["TERMINATION"], expectRefusal: false },
  { id: "q2", question: "영업비밀 누설 금지 조항이 있나요?", relevantClauseKeys: ["CONFIDENTIALITY"], expectRefusal: false },
  { id: "q3", question: "대금은 언제 지급되나요?", relevantClauseKeys: ["PAYMENT"], expectRefusal: false },
  { id: "q4", question: "손해배상 책임은 어떻게 되나요?", relevantClauseKeys: ["LIABILITY"], expectRefusal: false },
  {
    id: "q5",
    question: "수행 결과물의 지식재산권은 누구에게 귀속되나요?",
    relevantClauseKeys: ["INTELLECTUAL_PROPERTY"],
    expectRefusal: false,
  },
  { id: "q6", question: "개인정보는 어떻게 처리해야 하나요?", relevantClauseKeys: ["DATA_PROTECTION"], expectRefusal: false },
  {
    id: "q7",
    question: "계약을 위반하면 손해배상과 함께 계약 해지도 가능한가요?",
    relevantClauseKeys: ["TERMINATION", "LIABILITY"],
    expectRefusal: false,
  },
  { id: "q8", question: "오늘 서울 날씨는 어떤가요?", relevantClauseKeys: [], expectRefusal: true },
  { id: "q9", question: "이 회사의 주식 시세를 알려주세요.", relevantClauseKeys: [], expectRefusal: true },
  { id: "q10", question: "우주여행 티켓 가격이 궁금합니다.", relevantClauseKeys: [], expectRefusal: true },
];
