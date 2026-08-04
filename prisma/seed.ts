import "dotenv/config";

import { randomUUID } from "node:crypto";

import {
  ContractType,
  ContractStatus,
  MembershipRole,
  ClauseClassificationState,
  ClauseReviewSignalStatus,
  type ClauseType,
} from "../src/generated/prisma/enums";
import { Prisma } from "../src/generated/prisma/client";
import { normalizeClauseText } from "../src/domain/clauses/normalize-clause-text";
import { CLAUSE_SEGMENTER_VERSION } from "../src/domain/clauses/segmenter-version";
import { passwordHasher } from "../src/server/auth/password-hasher";
import { computeChecksum } from "../src/server/storage";
import { prisma } from "../src/server/db/client";

/**
 * Development-only password for both seed accounts. Documented in the
 * README so anyone can log in locally - never used outside development.
 */
const DEV_SEED_PASSWORD = "ClauseBase1234!";

const ORGANIZATION = {
  name: "주식회사 클로즈베이스",
  slug: "clausebase-dev",
};

const SEED_USERS = [
  { name: "오너", email: "owner@example.com", role: MembershipRole.OWNER },
  { name: "멤버", email: "member@example.com", role: MembershipRole.MEMBER },
] as const;

const SEED_COUNTERPARTIES = [
  {
    key: "alpha",
    name: "알파테크 주식회사",
    businessNumber: "123-45-67890",
    representativeName: "김알파",
    contactName: "박담당",
    contactEmail: "contact@alphatech.example.com",
    contactPhone: "02-1234-5678",
  },
  {
    key: "beta",
    name: "베타솔루션",
    businessNumber: "234-56-78901",
    representativeName: "이베타",
    contactName: "최담당",
    contactEmail: "contact@betasolution.example.com",
    contactPhone: "02-2345-6789",
  },
  {
    key: "gamma",
    name: "감마파트너스",
    businessNumber: "345-67-89012",
    representativeName: "정감마",
    contactName: "한담당",
    contactEmail: "contact@gammapartners.example.com",
    contactPhone: "02-3456-7890",
  },
] as const;

/**
 * Synthetic-only, development-use clause standards (§42) - the naming
 * always signals "개발용" / "테스트용" and the descriptions explicitly
 * disclaim any legal authority. Never seed anything that could be mistaken
 * for a real, legally-reviewed standard clause.
 */
const SEED_CLAUSE_STANDARDS: Array<{
  name: string;
  clauseType: ClauseType;
  title: string;
  text: string;
  description: string;
  isActive: boolean;
}> = [
  {
    name: "개발용 내부 참고 조항 - 계약기간",
    clauseType: "TERM",
    title: "계약기간",
    text: "본 계약의 유효기간은 계약 체결일로부터 1년으로 하며, 양 당사자가 별도의 서면 합의를 하지 않는 한 그 기간이 만료됨과 동시에 종료된다.",
    description: "테스트용 비교 기준 문구입니다. 법률적으로 검증된 표준이 아니며 실제 계약에 사용해서는 안 됩니다.",
    isActive: true,
  },
  {
    name: "개발용 내부 참고 조항 - 해지",
    clauseType: "TERMINATION",
    title: "해지",
    text: "일방 당사자가 본 계약을 위반하고 상대방으로부터 서면 시정 요구를 받은 날로부터 30일 이내에 이를 시정하지 아니하는 경우, 상대방은 서면 통지로써 본 계약을 해지할 수 있다.",
    description: "테스트용 비교 기준 문구입니다. 법률적으로 검증된 표준이 아니며 실제 계약에 사용해서는 안 됩니다.",
    isActive: true,
  },
  {
    name: "개발용 내부 참고 조항 - 대금 지급",
    clauseType: "PAYMENT",
    title: "대금 지급",
    text: "을은 갑에게 매월 말일을 기준으로 대금을 청구하며, 갑은 청구일로부터 30일 이내에 을이 지정한 계좌로 대금을 지급하여야 한다.",
    description: "테스트용 비교 기준 문구입니다. 법률적으로 검증된 표준이 아니며 실제 계약에 사용해서는 안 됩니다.",
    isActive: true,
  },
  {
    name: "개발용 내부 참고 조항 - 비밀유지",
    clauseType: "CONFIDENTIALITY",
    title: "비밀유지",
    text: "양 당사자는 본 계약과 관련하여 알게 된 상대방의 영업비밀 및 기밀정보를 상대방의 사전 서면 동의 없이 제3자에게 공개하거나 본 계약의 목적 외로 사용해서는 안 된다.",
    description: "테스트용 비교 기준 문구입니다. 법률적으로 검증된 표준이 아니며 실제 계약에 사용해서는 안 됩니다.",
    isActive: true,
  },
  {
    name: "개발용 내부 참고 조항 - 손해배상",
    clauseType: "LIABILITY",
    title: "손해배상",
    text: "일방 당사자의 귀책사유로 상대방에게 손해가 발생한 경우, 그 당사자는 상대방에게 발생한 직접적인 손해를 배상할 책임을 진다.",
    description: "테스트용 비교 기준 문구입니다. 법률적으로 검증된 표준이 아니며 실제 계약에 사용해서는 안 됩니다.",
    isActive: true,
  },
  {
    name: "개발용 내부 참고 조항 - 자동갱신 (비활성 예시)",
    clauseType: "AUTO_RENEWAL",
    title: "자동갱신",
    text: "계약 만료일 30일 전까지 양 당사자 중 어느 일방이 서면으로 갱신 거절의 의사를 통지하지 않는 경우, 본 계약은 동일한 조건으로 1년간 자동갱신된다.",
    description: "테스트용 비교 기준 문구입니다. isActive=false 상태의 예시 데이터로, 비교 대상에서 제외됩니다.",
    isActive: false,
  },
];

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

/**
 * Synthetic clause/segmentation/review-signal data for the SEED-SERVICE-001
 * contract (§47) - inserted directly via repository-shaped Prisma calls
 * (bypassing the extraction/segmentation worker queue, same
 * direct-insertion pattern the integration tests use), so a fresh
 * `pnpm db:seed` shows non-empty analytics screens without requiring
 * anyone to run the CLI workers first. Every entity is upserted on its own
 * natural/deterministic unique key (storageKey, the (contractFileId,
 * inputChecksum, extractorVersion) triple, extractionJobId, jobKey,
 * (segmentationJobId, orderIndex), signalKey) so re-running the seed never
 * duplicates rows.
 */
const SEED_SERVICE_CLAUSES: Array<{
  clauseNumber: string;
  title: string;
  text: string;
  suggestedClauseType: ClauseType;
  reviewedClauseType: ClauseType | null;
  classificationState: ClauseClassificationState;
}> = [
  {
    clauseNumber: "제1조",
    title: "목적",
    text: "제1조(목적) 이 계약은 갑과 을 간의 소프트웨어 개발 용역 제공에 관한 사항을 정함을 목적으로 한다.",
    suggestedClauseType: "SCOPE_OF_WORK",
    reviewedClauseType: null,
    classificationState: ClauseClassificationState.UNREVIEWED,
  },
  {
    clauseNumber: "제2조",
    title: "계약기간",
    text: "제2조(계약기간) 본 계약의 유효기간은 계약 체결일로부터 1년으로 하며, 만료일 30일 전까지 서면으로 갱신 거절의 의사를 통지하지 않는 경우 자동갱신된다.",
    suggestedClauseType: "TERM",
    reviewedClauseType: "TERM",
    classificationState: ClauseClassificationState.CONFIRMED,
  },
  {
    clauseNumber: "제3조",
    title: "대금 지급",
    text: "제3조(대금 지급) 갑은 을에게 매월 말일을 기준으로 용역 대금을 지급하며, 대금은 오만원으로 한다.",
    suggestedClauseType: "OTHER",
    reviewedClauseType: "PAYMENT",
    classificationState: ClauseClassificationState.CORRECTED,
  },
  {
    clauseNumber: "제4조",
    title: "비밀유지",
    text: "제4조(비밀유지) 양 당사자는 본 계약과 관련하여 알게 된 상대방의 기밀정보를 제3자에게 공개해서는 안 된다.",
    suggestedClauseType: "CONFIDENTIALITY",
    reviewedClauseType: null,
    classificationState: ClauseClassificationState.REJECTED,
  },
  {
    clauseNumber: "제5조",
    title: "손해배상",
    text: "제5조(손해배상) 일방 당사자의 귀책사유로 상대방에게 발생한 모든 손해에 대해 배상 책임을 진다.",
    suggestedClauseType: "LIABILITY",
    reviewedClauseType: null,
    classificationState: ClauseClassificationState.UNREVIEWED,
  },
];

function buildSeedHash(parts: readonly string[]): string {
  return computeChecksum(Buffer.from(parts.join(":"), "utf8"));
}

async function seedClauseIntelligenceData(params: {
  organizationId: string;
  ownerId: string;
  contractId: string;
  standardIdsByType: Partial<Record<ClauseType, string>>;
}): Promise<{ clauseCount: number; signalCount: number }> {
  const documentText = SEED_SERVICE_CLAUSES.map((clause) => clause.text).join("\n\n");
  const contentChecksum = computeChecksum(Buffer.from(documentText, "utf8"));

  const file = await prisma.contractFile.upsert({
    where: { storageKey: `seed/${params.contractId}/service-agreement.docx` },
    update: {},
    create: {
      organizationId: params.organizationId,
      contractId: params.contractId,
      uploadedById: params.ownerId,
      originalName: "소프트웨어_개발_용역계약서.docx",
      storageKey: `seed/${params.contractId}/service-agreement.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: documentText.length,
      checksum: contentChecksum,
    },
  });

  const extractorVersion = "seed-v1";
  const extractionJob = await prisma.contractExtractionJob.upsert({
    where: {
      contractFileId_inputChecksum_extractorVersion: {
        contractFileId: file.id,
        inputChecksum: contentChecksum,
        extractorVersion,
      },
    },
    update: {},
    create: {
      organizationId: params.organizationId,
      contractId: params.contractId,
      contractFileId: file.id,
      extractorVersion,
      inputChecksum: contentChecksum,
      createdById: params.ownerId,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  const document = await prisma.contractExtractedDocument.upsert({
    where: { extractionJobId: extractionJob.id },
    update: {},
    create: {
      extractionJobId: extractionJob.id,
      organizationId: params.organizationId,
      contractId: params.contractId,
      contractFileId: file.id,
      text: documentText,
      characterCount: documentText.length,
      extractionMethod: "seed",
      contentChecksum,
    },
  });

  const jobKey = buildSeedHash([document.id, document.contentChecksum, CLAUSE_SEGMENTER_VERSION]);
  const segmentationJob = await prisma.clauseSegmentationJob.upsert({
    where: { jobKey },
    update: {},
    create: {
      organizationId: params.organizationId,
      contractId: params.contractId,
      extractedDocumentId: document.id,
      segmenterVersion: CLAUSE_SEGMENTER_VERSION,
      inputChecksum: document.contentChecksum,
      jobKey,
      createdById: params.ownerId,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  const clauseIdByOrderIndex = new Map<number, string>();
  let offsetCursor = 0;
  for (let orderIndex = 0; orderIndex < SEED_SERVICE_CLAUSES.length; orderIndex += 1) {
    const clause = SEED_SERVICE_CLAUSES[orderIndex]!;
    const startOffset = documentText.indexOf(clause.text, offsetCursor);
    const endOffset = startOffset + clause.text.length;
    offsetCursor = endOffset;

    const row = await prisma.contractClause.upsert({
      where: { segmentationJobId_orderIndex: { segmentationJobId: segmentationJob.id, orderIndex } },
      update: {},
      create: {
        id: randomUUID(),
        organizationId: params.organizationId,
        contractId: params.contractId,
        extractedDocumentId: document.id,
        segmentationJobId: segmentationJob.id,
        clauseNumber: clause.clauseNumber,
        title: clause.title,
        text: clause.text,
        normalizedText: normalizeClauseText(clause.text),
        orderIndex,
        depth: 0,
        startOffset,
        endOffset,
        suggestedClauseType: clause.suggestedClauseType,
        reviewedClauseType: clause.reviewedClauseType,
        classificationState: clause.classificationState,
        classificationConfidence: new Prisma.Decimal("0.90"),
        reviewedById: clause.classificationState === ClauseClassificationState.UNREVIEWED ? null : params.ownerId,
        reviewedAt: clause.classificationState === ClauseClassificationState.UNREVIEWED ? null : new Date(),
      },
    });
    clauseIdByOrderIndex.set(orderIndex, row.id);
  }

  const ruleVersion = "seed-rules-v1";
  const signalDefinitions = [
    {
      signalType: "AUTO_RENEWAL_PRESENT" as const,
      contractClauseId: clauseIdByOrderIndex.get(1) ?? null,
      clauseType: null,
      clauseStandardId: null,
      status: ClauseReviewSignalStatus.OPEN,
      title: "자동갱신 관련 표현이 포함되어 있습니다",
      description: "제2조(계약기간)에 자동갱신 관련 표현이 포함되어 있습니다. 갱신 조건을 확인해 주세요.",
      evidenceText: "자동갱신된다",
      reviewNote: null as string | null,
    },
    {
      signalType: "MISSING_EXPECTED_CLAUSE" as const,
      contractClauseId: null,
      clauseType: "TERMINATION" as ClauseType,
      clauseStandardId: params.standardIdsByType.TERMINATION ?? null,
      status: ClauseReviewSignalStatus.ACKNOWLEDGED,
      title: "내부 기준 조항 유형과 일치하는 문구를 찾지 못했습니다",
      description: "내부 기준 조항 유형(해지)과 일치하는 문구를 이 계약에서 찾지 못했습니다.",
      evidenceText: null,
      reviewNote: "해지 조항 추가 여부 확인 중입니다.",
    },
    {
      signalType: "UNUSUAL_NUMBER" as const,
      contractClauseId: clauseIdByOrderIndex.get(2) ?? null,
      clauseType: null,
      clauseStandardId: params.standardIdsByType.PAYMENT ?? null,
      status: ClauseReviewSignalStatus.DISMISSED,
      title: "일반적인 기준과 다른 숫자가 포함되어 있습니다",
      description: "제3조(대금 지급)의 지급 기준일이 내부 기준 조항과 다릅니다.",
      evidenceText: "매월 말일",
      reviewNote: "이번 계약에 한해 의도된 조건으로 확인했습니다.",
    },
    {
      signalType: "BROAD_INDEMNITY_LANGUAGE" as const,
      contractClauseId: clauseIdByOrderIndex.get(4) ?? null,
      clauseType: null,
      clauseStandardId: params.standardIdsByType.LIABILITY ?? null,
      status: ClauseReviewSignalStatus.RESOLVED,
      title: "면책 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다",
      description: "제5조(손해배상)의 배상 범위 표현을 내부 기준 조항과 비교해 확인해 주세요.",
      evidenceText: "모든 손해",
      reviewNote: "문구를 수정하여 반영 완료했습니다.",
    },
  ];

  let signalCount = 0;
  for (const signal of signalDefinitions) {
    const signalKey = buildSeedHash([
      params.contractId,
      signal.contractClauseId ?? signal.clauseType ?? "none",
      signal.signalType,
      ruleVersion,
    ]);
    const isOpen = signal.status === ClauseReviewSignalStatus.OPEN;
    await prisma.clauseReviewSignal.upsert({
      where: { signalKey },
      update: {},
      create: {
        organizationId: params.organizationId,
        contractId: params.contractId,
        contractClauseId: signal.contractClauseId,
        clauseStandardId: signal.clauseStandardId,
        clauseType: signal.clauseType,
        signalType: signal.signalType,
        status: signal.status,
        title: signal.title,
        description: signal.description,
        evidenceText: signal.evidenceText,
        ruleVersion,
        signalKey,
        reviewedById: isOpen ? null : params.ownerId,
        reviewedAt: isOpen ? null : new Date(),
        reviewNote: signal.reviewNote,
      },
    });
    signalCount += 1;
  }

  return { clauseCount: SEED_SERVICE_CLAUSES.length, signalCount };
}

/**
 * Each entry maps to one required sample scenario (see Phase 3 README):
 * DRAFT / far-future ACTIVE / 7-day expiring / 30-day boundary expiring /
 * 31-day boundary (stays ACTIVE) / already expired / TERMINATED / ARCHIVED.
 */
function buildSeedContracts(counterpartyIds: Record<string, string>) {
  return [
    {
      contractNumber: "SEED-NDA-001",
      title: "비밀유지계약서",
      contractType: ContractType.NDA,
      status: ContractStatus.DRAFT,
      endDate: null,
      amount: null,
      currency: null,
      autoRenewal: false,
      counterpartyId: null,
    },
    {
      contractNumber: "SEED-SERVICE-001",
      title: "소프트웨어 개발 용역계약",
      contractType: ContractType.SERVICE,
      status: ContractStatus.ACTIVE,
      endDate: daysFromNow(60),
      amount: "50000000",
      currency: "KRW",
      autoRenewal: true,
      counterpartyId: counterpartyIds.alpha,
    },
    {
      contractNumber: "SEED-SUPPLY-001",
      title: "솔루션 공급계약",
      contractType: ContractType.SUPPLY,
      status: ContractStatus.ACTIVE,
      endDate: daysFromNow(7),
      amount: "12000000",
      currency: "KRW",
      autoRenewal: false,
      counterpartyId: counterpartyIds.beta,
    },
    {
      contractNumber: "SEED-LEASE-001",
      title: "사무실 임대차계약",
      contractType: ContractType.LEASE,
      status: ContractStatus.ACTIVE,
      endDate: daysFromNow(30),
      amount: "8000000",
      currency: "KRW",
      autoRenewal: true,
      counterpartyId: null,
    },
    {
      contractNumber: "SEED-LICENSE-001",
      title: "기술 라이선스 계약",
      contractType: ContractType.LICENSE,
      status: ContractStatus.ACTIVE,
      endDate: daysFromNow(31),
      amount: "30000000",
      currency: "USD",
      autoRenewal: false,
      counterpartyId: counterpartyIds.alpha,
    },
    {
      contractNumber: "SEED-EMPLOYMENT-001",
      title: "근로계약",
      contractType: ContractType.EMPLOYMENT,
      status: ContractStatus.ACTIVE,
      endDate: daysFromNow(-10),
      amount: null,
      currency: null,
      autoRenewal: false,
      counterpartyId: null,
    },
    {
      contractNumber: "SEED-INVESTMENT-001",
      title: "투자계약",
      contractType: ContractType.INVESTMENT,
      status: ContractStatus.TERMINATED,
      endDate: daysFromNow(-200),
      amount: "500000000",
      currency: "KRW",
      autoRenewal: false,
      counterpartyId: counterpartyIds.gamma,
    },
    {
      contractNumber: "SEED-PARTNERSHIP-001",
      title: "파트너십 계약",
      contractType: ContractType.PARTNERSHIP,
      status: ContractStatus.ARCHIVED,
      endDate: daysFromNow(-400),
      amount: null,
      currency: null,
      autoRenewal: false,
      counterpartyId: counterpartyIds.gamma,
    },
  ];
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run seed script with NODE_ENV=production.");
  }

  const organization = await prisma.organization.upsert({
    where: { slug: ORGANIZATION.slug },
    update: { name: ORGANIZATION.name },
    create: { name: ORGANIZATION.name, slug: ORGANIZATION.slug },
  });

  const passwordHash = await passwordHasher.hash(DEV_SEED_PASSWORD);

  let ownerId: string | undefined;

  for (const seedUser of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: { name: seedUser.name, passwordHash },
      create: { name: seedUser.name, email: seedUser.email, passwordHash },
    });

    if (seedUser.role === MembershipRole.OWNER) {
      ownerId = user.id;
    }

    await prisma.membership.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: organization.id,
        },
      },
      update: { role: seedUser.role },
      create: {
        userId: user.id,
        organizationId: organization.id,
        role: seedUser.role,
      },
    });
  }

  if (!ownerId) {
    throw new Error("Seed OWNER user was not created.");
  }

  const counterpartyIds: Record<string, string> = {};
  for (const counterparty of SEED_COUNTERPARTIES) {
    const existing = await prisma.counterparty.findFirst({
      where: { organizationId: organization.id, name: counterparty.name },
      select: { id: true },
    });

    const counterpartyData = {
      name: counterparty.name,
      businessNumber: counterparty.businessNumber,
      representativeName: counterparty.representativeName,
      contactName: counterparty.contactName,
      contactEmail: counterparty.contactEmail,
      contactPhone: counterparty.contactPhone,
    };

    const record = existing
      ? await prisma.counterparty.update({
          where: { id: existing.id },
          data: counterpartyData,
        })
      : await prisma.counterparty.create({
          data: { organizationId: organization.id, ...counterpartyData },
        });

    counterpartyIds[counterparty.key] = record.id;
  }

  const seedContracts = buildSeedContracts(counterpartyIds);
  const contractIdsByNumber: Record<string, string> = {};
  for (const contract of seedContracts) {
    const existing = await prisma.contract.findFirst({
      where: { organizationId: organization.id, contractNumber: contract.contractNumber },
      select: { id: true },
    });

    const data = {
      organizationId: organization.id,
      createdById: ownerId,
      title: contract.title,
      contractNumber: contract.contractNumber,
      contractType: contract.contractType,
      status: contract.status,
      endDate: contract.endDate,
      amount: contract.amount,
      currency: contract.currency,
      autoRenewal: contract.autoRenewal,
      counterpartyId: contract.counterpartyId,
    };

    const record = existing
      ? await prisma.contract.update({ where: { id: existing.id }, data })
      : await prisma.contract.create({ data });
    contractIdsByNumber[contract.contractNumber] = record.id;
  }

  const standardIdsByType: Partial<Record<ClauseType, string>> = {};
  for (const standard of SEED_CLAUSE_STANDARDS) {
    const existing = await prisma.clauseStandard.findFirst({
      where: { organizationId: organization.id, name: standard.name },
      select: { id: true },
    });

    const standardData = {
      name: standard.name,
      clauseType: standard.clauseType,
      title: standard.title,
      text: standard.text,
      normalizedText: normalizeClauseText(standard.text),
      description: standard.description,
      isActive: standard.isActive,
    };

    const record = existing
      ? await prisma.clauseStandard.update({ where: { id: existing.id }, data: standardData })
      : await prisma.clauseStandard.create({
          data: { organizationId: organization.id, createdById: ownerId, ...standardData },
        });
    standardIdsByType[standard.clauseType] = record.id;
  }

  const clauseIntelligenceCounts = await seedClauseIntelligenceData({
    organizationId: organization.id,
    ownerId,
    contractId: contractIdsByNumber["SEED-SERVICE-001"]!,
    standardIdsByType,
  });

  console.log(
    `Seeded organization "${organization.name}", ${SEED_USERS.length} user(s), ${SEED_COUNTERPARTIES.length} counterpart(ies), ${seedContracts.length} contract(s), ${SEED_CLAUSE_STANDARDS.length} clause standard(s), ${clauseIntelligenceCounts.clauseCount} clause(s), ${clauseIntelligenceCounts.signalCount} review signal(s).`
  );
  console.log("Login with the accounts documented in README.md.");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
