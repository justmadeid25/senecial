/** §Evaluation (Phase 12 Part L, extended Phase 12.1 §19) - report shape shared between the runner (features/ai/server/run-ai-evaluation.ts) and the pure Markdown renderer (evaluation-report-markdown.ts). Lives in the domain layer since it carries no I/O. */
export interface PerQuestionEvaluationResult {
  id: string;
  question: string;
  expectRefusal: boolean;
  relevantClauseCount: number;
  retrievedCount: number;
  recall: number;
  precision: number;
  reciprocalRank: number;
  ndcg: number;
  hit: boolean;
  actuallyRefused: boolean;
  hallucinated: boolean;
  falselyRefused: boolean;
  /** False only if assertEveryParagraphHasCitation() rejected the answer (caught, not thrown - see run-ai-evaluation.ts) - a real, if rare in practice, failure mode distinct from hallucination/false-refusal. */
  citationValid: boolean;
}

export interface EvaluationSummary {
  questionCount: number;
  topK: number;
  meanRecall: number;
  meanPrecision: number;
  meanReciprocalRank: number;
  meanNdcg: number;
  hitRate: number;
  hallucinationRate: number;
  falseRefusalRate: number;
  citationValidityRate: number;
}

export interface EvaluationReport {
  generatedAt: string;
  vectorSearchProvider: string;
  embeddingProvider: string;
  llmProvider: string;
  summary: EvaluationSummary;
  perQuestion: PerQuestionEvaluationResult[];
}
