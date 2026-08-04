export interface SegmentedSection {
  title?: string;
  sectionType?: string;
  text: string;
  orderIndex: number;
  startOffset: number;
  endOffset: number;
}

export interface SegmentedClause {
  clauseNumber?: string;
  title?: string;
  text: string;
  orderIndex: number;
  depth: number;
  startOffset: number;
  endOffset: number;
  /** orderIndex of this clause's parent within the same segmentation result, if any. */
  parentOrderIndex?: number;
}

export interface ClauseSegmentationResult {
  sections: SegmentedSection[];
  clauses: SegmentedClause[];
  warnings: string[];
  method: string;
  version: string;
}

export interface ContractClauseSegmenter {
  segment(input: { text: string; locale: "ko-KR" }): Promise<ClauseSegmentationResult>;
}
