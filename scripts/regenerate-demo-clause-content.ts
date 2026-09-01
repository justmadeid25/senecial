import "dotenv/config";

import { Document, Packer, Paragraph } from "docx";

import { createExtractionJob } from "../src/features/extraction/server/create-extraction-job";
import { uploadContractFile } from "../src/features/contract-files/server/upload-contract-file";
import { getStorageDriverForProvider } from "../src/server/storage";
import { prisma } from "../src/server/db/client";

/**
 * Replaces the first-pass DEMO- contract content (8 repeating clause
 * templates cycling with a modulo index - see seed-synthetic-benchmark-data.ts's
 * generateSyntheticClauseText, meant for vector-search BENCHMARKING where
 * distinct clause identity doesn't matter) with content that actually pulls
 * each contract's own amount/currency/counterparty/dates/autoRenewal into
 * the clause text. That real per-contract variation is what makes 200
 * documents produce 200 genuinely different embeddings instead of ~8
 * near-duplicate clusters that drown out real content in AI search - the
 * first pass was fine for portfolio/analytics row counts but actively hurt
 * AI answer quality once wired to real OpenAI embeddings.
 *
 * Deletes each DEMO- contract's existing file/extraction/segmentation/
 * clause/embedding/review-signal chain first (contract + counterparty rows
 * themselves are untouched), then re-runs the real upload -> extraction
 * pipeline entry points. Run the batch scripts afterward to actually
 * process the re-queued jobs (extraction:process, the segmentation-job
 * enqueue script, clauses:process, ai:process-embeddings,
 * clauses:generate-signals).
 *
 * Same "never in production, plus explicit opt-in" guard as
 * disaster-recovery-drill.ts - NODE_ENV=production alone cannot be trusted
 * to catch a DATABASE_URL that was accidentally left pointed at production
 * while running locally with NODE_ENV unset/development, and this script
 * deletes real rows. Also prints (never logs the URL/credentials
 * themselves, matching e2e-db-reset.ts's convention) the target database
 * name so an operator gets one last chance to notice a wrong target before
 * any deletion happens.
 */

const ORG_SLUG = "senecial-dev";
const OWNER_EMAIL = "owner@example.com";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const CITIES = ["서울중앙지방법원", "서울동부지방법원", "수원지방법원", "부산지방법원", "인천지방법원"] as const;

function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (Math.imul(1103515245, h) + 12345) | 0;
    return ((h >>> 1) % 10000) / 10000;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function formatDate(date: Date | null): string {
  if (!date) return "별도 협의일";
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

interface ContractForDoc {
  id: string;
  title: string;
  contractType: string;
  amount: unknown;
  currency: string | null;
  autoRenewal: boolean;
  startDate: Date | null;
  endDate: Date | null;
  counterparty: { name: string } | null;
}

function buildClauseTexts(contract: ContractForDoc): string[] {
  const rand = seededRandom(contract.id);
  const cp = contract.counterparty?.name ?? "상대방";
  const amountText = contract.amount ? `${Number(contract.amount).toLocaleString("ko-KR")}${contract.currency ?? "KRW"}` : null;
  const noticeDays = 15 + Math.floor(rand() * 46); // 15~60
  const confidentialityYears = 1 + Math.floor(rand() * 5); // 1~5
  const damagePercent = 50 + Math.floor(rand() * 51); // 50~100

  const clauses: string[] = [
    `제1조(목적) 이 계약은 ${cp}과(와)의 "${contract.title}" 이행에 관한 사항을 정함을 목적으로 한다.`,
    `제2조(계약기간) 본 계약의 유효기간은 ${formatDate(contract.startDate)}부터 ${formatDate(contract.endDate)}까지로 하며, ${
      contract.autoRenewal
        ? "만료일 30일 전까지 어느 일방의 서면 갱신 거절 통지가 없는 한 동일한 조건으로 자동갱신된다."
        : "별도의 갱신 절차 없이 만료일에 종료된다."
    }`,
  ];

  clauses.push(
    amountText
      ? `제3조(대금 지급) ${cp}은(는) 본 계약에 따른 대금으로 ${amountText}을(를) 계약서에서 정한 조건에 따라 지급한다.`
      : `제3조(대금) 본 계약은 무상으로 진행되며 별도의 대금 지급 의무는 발생하지 않는다.`
  );

  clauses.push(
    `제4조(비밀유지) 양 당사자는 본 계약과 관련하여 알게 된 상대방의 영업비밀 및 기밀정보를 계약 종료 후 ${confidentialityYears}년간 상대방의 사전 서면 동의 없이 제3자에게 공개하거나 목적 외로 사용하여서는 안 된다.`
  );

  clauses.push(
    `제5조(손해배상) 일방 당사자의 귀책사유로 상대방에게 손해가 발생한 경우, 그 당사자는 상대방에게 발생한 손해액의 ${damagePercent}%를 한도로 배상할 책임을 진다.`
  );

  clauses.push(
    `제6조(해지) 일방 당사자가 본 계약을 위반하고 상대방으로부터 서면 시정 요구를 받은 날로부터 ${noticeDays}일 이내에 이를 시정하지 아니하는 경우, 상대방은 서면 통지로써 본 계약을 해지할 수 있다.`
  );

  if (contract.contractType === "SERVICE" || contract.contractType === "LICENSE") {
    clauses.push(
      `제7조(지식재산권) 본 계약의 수행 과정에서 발생한 결과물에 대한 지식재산권은 ${rand() > 0.5 ? "발주자" : cp}에게 귀속된다.`
    );
  }

  clauses.push(`제8조(관할) 본 계약과 관련하여 발생하는 분쟁에 대해서는 ${pick(rand, CITIES)}을(를) 전속 관할 법원으로 한다.`);

  return clauses;
}

async function buildDocxBuffer(contract: ContractForDoc): Promise<Buffer> {
  const paragraphs = [contract.title, ...buildClauseTexts(contract)].map((line) => new Paragraph(line));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function deleteExistingChain(contractId: string): Promise<void> {
  const clauseIds = (
    await prisma.contractClause.findMany({ where: { contractId }, select: { id: true } })
  ).map((c) => c.id);

  if (clauseIds.length > 0) {
    await prisma.clauseEmbedding.deleteMany({ where: { contractClauseId: { in: clauseIds } } });
    await prisma.clauseReviewSignal.deleteMany({ where: { contractClauseId: { in: clauseIds } } });
  }
  await prisma.clauseReviewSignal.deleteMany({ where: { contractId } });
  await prisma.contractClause.deleteMany({ where: { contractId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId } });

  const files = await prisma.contractFile.findMany({
    where: { contractId },
    select: { id: true, storageKey: true, storageProvider: true },
  });
  await prisma.contractFile.deleteMany({ where: { contractId } });

  for (const file of files) {
    try {
      const driver = getStorageDriverForProvider(file.storageProvider as Parameters<typeof getStorageDriverForProvider>[0]);
      await driver.delete(file.storageKey);
    } catch {
      // best-effort cleanup only - a leftover local file is harmless in dev
    }
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("regenerate-demo-clause-content은 운영 환경(NODE_ENV=production)에서 절대 실행할 수 없습니다.");
  }
  if (process.env.DEMO_DATA_CONFIRM !== "true") {
    throw new Error(
      "regenerate-demo-clause-content를 실행하려면 DEMO_DATA_CONFIRM=true 환경변수를 명시적으로 설정하십시오 " +
        "(이 스크립트는 DEMO- 계약의 기존 파일/추출/조항/임베딩 데이터를 삭제 후 재생성합니다)."
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }
  // Never log the URL itself (embeds credentials) - only which database
  // name it targets, matching e2e-db-reset.ts's own convention.
  const targetDatabase = new URL(databaseUrl).pathname.replace(/^\//, "");
  console.log(`[regenerate-demo-clause-content] target database: ${targetDatabase}`);

  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) throw new Error(`Organization "${ORG_SLUG}" not found.`);
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!owner) throw new Error(`User "${OWNER_EMAIL}" not found.`);

  const contracts = await prisma.contract.findMany({
    where: { organizationId: organization.id, contractNumber: { startsWith: "DEMO-" }, deletedAt: null },
    include: { counterparty: { select: { name: true } } },
    orderBy: { contractNumber: "asc" },
  });

  console.log(`${contracts.length}건의 DEMO 계약 콘텐츠를 재생성합니다...`);

  let done = 0;
  for (const contract of contracts) {
    await deleteExistingChain(contract.id);

    const buffer = await buildDocxBuffer(contract);
    const uploaded = await uploadContractFile({
      userId: owner.id,
      organizationId: organization.id,
      contractId: contract.id,
      originalName: `${contract.title}.docx`,
      mimeType: DOCX_MIME,
      buffer,
    });

    await createExtractionJob({
      userId: owner.id,
      organizationId: organization.id,
      contractId: contract.id,
      input: { contractFileId: uploaded.id },
    });

    done += 1;
    if (done % 20 === 0) {
      console.log(`  ...${done}/${contracts.length}건 재생성`);
    }
  }

  console.log(`완료: ${done}건 재생성 및 추출 작업 등록. 다음 순서로 실제 파이프라인을 돌리세요:`);
  console.log(`  npm run extraction:process -- --limit=${done}`);
  console.log(`  npx tsx scripts/enqueue-demo-segmentation-jobs.ts`);
  console.log(`  npm run clauses:process -- --limit=${done}`);
  console.log(`  npm run ai:process-embeddings -- --limit=2000`);
  console.log(`  npm run clauses:generate-signals`);
}

main()
  .catch((error: unknown) => {
    console.error("데모 조항 콘텐츠 재생성 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
