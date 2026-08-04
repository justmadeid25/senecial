import type { ContractStatus, ContractType } from "@/generated/prisma/enums";

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  NDA: "비밀유지계약(NDA)",
  SERVICE: "용역계약",
  SUPPLY: "공급계약",
  EMPLOYMENT: "근로계약",
  LICENSE: "라이선스계약",
  INVESTMENT: "투자계약",
  SHAREHOLDER: "주주간계약",
  LEASE: "임대차계약",
  PARTNERSHIP: "파트너십계약",
  OTHER: "기타",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "초안",
  ACTIVE: "진행중",
  EXPIRING: "만료 임박",
  EXPIRED: "만료",
  TERMINATED: "해지",
  ARCHIVED: "보관",
};
