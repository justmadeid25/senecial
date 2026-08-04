import "dotenv/config";

import { randomUUID } from "node:crypto";

import {
  ClauseClassificationState,
  ClauseReviewSignalStatus,
  ClauseReviewSignalType,
  ClauseType,
  ContractStatus,
  ContractType,
  MembershipRole,
} from "../src/generated/prisma/enums";
import { normalizeClauseText } from "../src/domain/clauses/normalize-clause-text";
import { CLAUSE_SEGMENTER_VERSION } from "../src/domain/clauses/segmenter-version";
import { passwordHasher } from "../src/server/auth/password-hasher";
import { computeChecksum } from "../src/server/storage";
import { prisma } from "../src/server/db/client";

/**
 * §25/§36 - generates large-scale synthetic data in a DEDICATED
 * organization (never the normal dev seed org) so §25's benchmark
 * conditions (1,000 contracts / 50,000 clauses / 10,000 review signals) can
 * be measured without polluting the normal `pnpm db:seed` dataset. Refused
 * outside development, same guard as the main seed script.
 *
 * All content is synthetic placeholder text - no real company names,
 * contracts, or personal data.
 */

const CONTRACT_COUNT = Number(process.env.ANALYTICS_PERF_CONTRACTS ?? 1000);
const COUNTERPARTY_COUNT = Number(process.env.ANALYTICS_PERF_COUNTERPARTIES ?? 100);
const CLAUSE_TOTAL = Number(process.env.ANALYTICS_PERF_CLAUSES ?? 50000);
const SIGNAL_TOTAL = Number(process.env.ANALYTICS_PERF_SIGNALS ?? 10000);
const CLAUSE_CONTRACT_COUNT = Math.min(CONTRACT_COUNT, 500);
const CLAUSES_PER_CONTRACT = Math.max(1, Math.round(CLAUSE_TOTAL / CLAUSE_CONTRACT_COUNT));

const ORGANIZATION = { name: "분석 성능 테스트 조직", slug: "clausebase-analytics-perf" };
const OWNER_EMAIL = "perf-owner@example.com";
const DEV_PASSWORD = "ClauseBase1234!";

const CONTRACT_TYPES = Object.values(ContractType);
const CLAUSE_TYPES = Object.values(ClauseType);
const CLASSIFICATION_STATES = Object.values(ClauseClassificationState);
const SIGNAL_TYPES = Object.values(ClauseReviewSignalType);
const SIGNAL_STATUSES = Object.values(ClauseReviewSignalStatus);
const CURRENCIES = ["KRW", "USD", "JPY", "EUR"];

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run performance seed script with NODE_ENV=production.");
  }

  console.log(
    `Target scale: ${CONTRACT_COUNT} contracts, ${COUNTERPARTY_COUNT} counterparties, ${CLAUSE_TOTAL} clauses (${CLAUSES_PER_CONTRACT}/contract over ${CLAUSE_CONTRACT_COUNT} contracts), ${SIGNAL_TOTAL} review signals.`
  );

  const startedAt = Date.now();

  const organization = await prisma.organization.upsert({
    where: { slug: ORGANIZATION.slug },
    update: { name: ORGANIZATION.name },
    create: { name: ORGANIZATION.name, slug: ORGANIZATION.slug },
  });

  const passwordHash = await passwordHasher.hash(DEV_PASSWORD);
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { name: "성능 테스트 오너", passwordHash },
    create: { name: "성능 테스트 오너", email: OWNER_EMAIL, passwordHash },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: organization.id } },
    update: { role: MembershipRole.OWNER },
    create: { userId: owner.id, organizationId: organization.id, role: MembershipRole.OWNER },
  });

  console.log("Clearing previous performance-test data for this organization...");
  await prisma.clauseReviewSignal.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contractClause.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contractSection.deleteMany({ where: { organizationId: organization.id } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contractExtractedDocument.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contractExtractionJob.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contractFile.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contract.deleteMany({ where: { organizationId: organization.id } });
  await prisma.counterparty.deleteMany({ where: { organizationId: organization.id } });

  console.log(`Creating ${COUNTERPARTY_COUNT} counterparties...`);
  const counterpartyIds = Array.from({ length: COUNTERPARTY_COUNT }, () => randomUUID());
  await prisma.counterparty.createMany({
    data: counterpartyIds.map((id, index) => ({
      id,
      organizationId: organization.id,
      name: `성능 테스트 상대방 ${String(index + 1).padStart(4, "0")}`,
    })),
  });

  console.log(`Creating ${CONTRACT_COUNT} contracts...`);
  const contractIds = Array.from({ length: CONTRACT_COUNT }, () => randomUUID());
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const contractRows = contractIds.map((id, index) => {
    const contractType = CONTRACT_TYPES[index % CONTRACT_TYPES.length]!;
    const currency = CURRENCIES[index % CURRENCIES.length]!;
    const hasAmount = index % 5 !== 0;
    const hasCounterparty = index % 4 !== 0;
    const endDateOffsetDays = ((index * 37) % 730) - 365; // spread across ~[-365, 365) days
    return {
      id,
      organizationId: organization.id,
      createdById: owner.id,
      title: `성능 테스트 계약 ${String(index + 1).padStart(5, "0")}`,
      contractNumber: `PERF-${String(index + 1).padStart(6, "0")}`,
      contractType,
      status: ContractStatus.ACTIVE,
      endDate: new Date(now + endDateOffsetDays * DAY_MS),
      autoRenewal: index % 3 === 0,
      amount: hasAmount ? String(1000000 + (index % 500) * 10000) : null,
      currency: hasAmount ? currency : null,
      counterpartyId: hasCounterparty ? counterpartyIds[index % counterpartyIds.length] : null,
    };
  });
  for (const batch of chunk(contractRows, 1000)) {
    await prisma.contract.createMany({ data: batch });
  }

  console.log(`Creating clause segmentation infrastructure and ${CLAUSE_TOTAL} clauses...`);
  const clauseContractIds = contractIds.slice(0, CLAUSE_CONTRACT_COUNT);
  const allClauseIds: string[] = [];
  const allClauseContractIds: string[] = [];
  let clauseRowBuffer: Array<Record<string, unknown>> = [];

  for (const [contractIndex, contractId] of clauseContractIds.entries()) {
    const fileId = randomUUID();
    const extractionJobId = randomUUID();
    const documentId = randomUUID();
    const segmentationJobId = randomUUID();

    const clauseTexts = Array.from(
      { length: CLAUSES_PER_CONTRACT },
      (_, i) => `제${i + 1}조(성능 테스트 조항 ${i + 1}) 이 조항은 성능 측정을 위한 합성 데이터입니다.`
    );
    const documentText = clauseTexts.join("\n");
    const contentChecksum = computeChecksum(Buffer.from(`${contractId}:${documentText}`, "utf8"));

    await prisma.contractFile.create({
      data: {
        id: fileId,
        organizationId: organization.id,
        contractId,
        uploadedById: owner.id,
        originalName: "perf-seed.docx",
        storageKey: `perf-seed/${contractId}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: documentText.length,
        checksum: contentChecksum,
      },
    });
    await prisma.contractExtractionJob.create({
      data: {
        id: extractionJobId,
        organizationId: organization.id,
        contractId,
        contractFileId: fileId,
        extractorVersion: "perf-seed-v1",
        inputChecksum: contentChecksum,
        createdById: owner.id,
        status: "COMPLETED",
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    await prisma.contractExtractedDocument.create({
      data: {
        id: documentId,
        extractionJobId,
        organizationId: organization.id,
        contractId,
        contractFileId: fileId,
        text: documentText,
        characterCount: documentText.length,
        extractionMethod: "perf-seed",
        contentChecksum,
      },
    });
    const jobKey = computeChecksum(Buffer.from(`${documentId}:${contentChecksum}:${CLAUSE_SEGMENTER_VERSION}`, "utf8"));
    await prisma.clauseSegmentationJob.create({
      data: {
        id: segmentationJobId,
        organizationId: organization.id,
        contractId,
        extractedDocumentId: documentId,
        segmenterVersion: CLAUSE_SEGMENTER_VERSION,
        inputChecksum: contentChecksum,
        jobKey,
        createdById: owner.id,
        status: "COMPLETED",
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    let cursor = 0;
    for (const [orderIndex, text] of clauseTexts.entries()) {
      const startOffset = cursor;
      const endOffset = startOffset + text.length;
      cursor = endOffset + 1; // account for the "\n" join separator
      const globalIndex = contractIndex * CLAUSES_PER_CONTRACT + orderIndex;
      const clauseId = randomUUID();
      const clauseType = CLAUSE_TYPES[globalIndex % CLAUSE_TYPES.length]!;
      const classificationState = CLASSIFICATION_STATES[globalIndex % CLASSIFICATION_STATES.length]!;
      const isReviewed = classificationState !== ClauseClassificationState.UNREVIEWED;

      clauseRowBuffer.push({
        id: clauseId,
        organizationId: organization.id,
        contractId,
        extractedDocumentId: documentId,
        segmentationJobId,
        clauseNumber: `제${orderIndex + 1}조`,
        title: `성능 테스트 조항 ${orderIndex + 1}`,
        text,
        normalizedText: normalizeClauseText(text),
        orderIndex,
        depth: 0,
        startOffset,
        endOffset,
        suggestedClauseType: clauseType,
        reviewedClauseType: isReviewed ? clauseType : null,
        classificationState,
        reviewedById: isReviewed ? owner.id : null,
        reviewedAt: isReviewed ? new Date() : null,
      });
      allClauseIds.push(clauseId);
      allClauseContractIds.push(contractId);

      if (clauseRowBuffer.length >= 2000) {
        await prisma.contractClause.createMany({ data: clauseRowBuffer as never });
        clauseRowBuffer = [];
      }
    }

    if ((contractIndex + 1) % 50 === 0) {
      console.log(`  ...${contractIndex + 1}/${CLAUSE_CONTRACT_COUNT} contracts segmented`);
    }
  }
  if (clauseRowBuffer.length > 0) {
    await prisma.contractClause.createMany({ data: clauseRowBuffer as never });
  }

  console.log(`Creating ${SIGNAL_TOTAL} review signals...`);
  let signalBuffer: Array<Record<string, unknown>> = [];
  for (let i = 0; i < SIGNAL_TOTAL; i += 1) {
    const clauseIndex = i % allClauseIds.length;
    const signalType = SIGNAL_TYPES[i % SIGNAL_TYPES.length]!;
    const status = SIGNAL_STATUSES[i % SIGNAL_STATUSES.length]!;
    const isOpen = status === ClauseReviewSignalStatus.OPEN;
    const signalKey = computeChecksum(
      Buffer.from(`perf:${allClauseContractIds[clauseIndex]}:${allClauseIds[clauseIndex]}:${signalType}:${i}`, "utf8")
    );
    signalBuffer.push({
      id: randomUUID(),
      organizationId: organization.id,
      contractId: allClauseContractIds[clauseIndex],
      contractClauseId: allClauseIds[clauseIndex],
      signalType,
      status,
      title: "성능 테스트 검토 신호",
      description: "성능 측정을 위한 합성 검토 신호입니다.",
      ruleVersion: "perf-seed-v1",
      signalKey,
      reviewedById: isOpen ? null : owner.id,
      reviewedAt: isOpen ? null : new Date(),
    });
    if (signalBuffer.length >= 2000) {
      await prisma.clauseReviewSignal.createMany({ data: signalBuffer as never });
      signalBuffer = [];
    }
  }
  if (signalBuffer.length > 0) {
    await prisma.clauseReviewSignal.createMany({ data: signalBuffer as never });
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done in ${elapsedSeconds}s. Organization id: ${organization.id}`);
}

main()
  .catch((error: unknown) => {
    console.error("Performance seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
