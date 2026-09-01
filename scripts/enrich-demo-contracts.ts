import "dotenv/config";

import { Document, Packer, Paragraph } from "docx";

import { generateSyntheticClauseText } from "../src/features/ai/server/seed-synthetic-benchmark-data";
import { createExtractionJob } from "../src/features/extraction/server/create-extraction-job";
import { uploadContractFile } from "../src/features/contract-files/server/upload-contract-file";
import { prisma } from "../src/server/db/client";

/**
 * Attaches a REAL docx file + description + a queued extraction job to
 * every "DEMO-" filler contract created by seed-demo-contracts-bulk.ts, so
 * they go through the actual upload -> extraction -> segmentation pipeline
 * (same feature functions the app itself calls) instead of being bare rows
 * with no file. Run scripts/process-extraction-jobs.ts and
 * process-clause-segmentation-jobs.ts afterwards to actually drain the
 * queue this creates. Idempotent: skips any DEMO- contract that already has
 * a file attached, so re-running only tops up newly created ones.
 */

const ORG_SLUG = "senecial-dev";
const OWNER_EMAIL = "owner@example.com";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DESCRIPTION_TEMPLATES = [
  (title: string, cp: string | null) =>
    `${cp ? `${cp}과(와) 체결한 ` : ""}${title} 관련 계약입니다. 정기적으로 이행 현황을 점검할 필요가 있습니다.`,
  (title: string, cp: string | null) =>
    `${title}. ${cp ? `거래처는 ${cp}이며, ` : ""}표준 계약서 양식을 기반으로 작성되었습니다.`,
  (title: string, cp: string | null) =>
    `${cp ? `${cp} 측과 협의한 조건에 따라 ` : ""}작성된 ${title}입니다. 갱신 여부는 만료일 전 검토가 필요합니다.`,
];

async function buildDocxBuffer(title: string, clauseCount: number, seed: number): Promise<Buffer> {
  const paragraphs = [
    new Paragraph(title),
    new Paragraph(`제1조(목적) 이 계약은 ${title}의 이행에 관한 사항을 정함을 목적으로 한다.`),
  ];
  for (let i = 0; i < clauseCount; i += 1) {
    paragraphs.push(new Paragraph(generateSyntheticClauseText(seed + i)));
  }
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run demo enrichment with NODE_ENV=production.");
  }

  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`Organization "${ORG_SLUG}" not found - run "npm run db:seed" first.`);
  }
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!owner) {
    throw new Error(`User "${OWNER_EMAIL}" not found - run "npm run db:seed" first.`);
  }

  const contracts = await prisma.contract.findMany({
    where: {
      organizationId: organization.id,
      contractNumber: { startsWith: "DEMO-" },
      files: { none: {} },
    },
    include: { counterparty: { select: { name: true } } },
    orderBy: { contractNumber: "asc" },
  });

  if (contracts.length === 0) {
    console.log("파일이 없는 DEMO- 계약이 없습니다. 이미 다 처리됐거나 대상이 없습니다.");
    return;
  }

  console.log(`${contracts.length}건에 파일 + 설명 + 추출 작업을 붙입니다...`);

  let processed = 0;
  for (const contract of contracts) {
    const description = pick(DESCRIPTION_TEMPLATES)(contract.title, contract.counterparty?.name ?? null);
    await prisma.contract.update({
      where: { id: contract.id },
      data: { description },
    });

    const clauseCount = 3 + Math.floor(Math.random() * 4); // 3~6 additional clauses
    const buffer = await buildDocxBuffer(contract.title, clauseCount, processed * 7);

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

    processed += 1;
    if (processed % 20 === 0) {
      console.log(`  ...${processed}/${contracts.length}건 처리`);
    }
  }

  console.log(`완료: ${processed}건에 파일/설명/추출 작업 부착. 이제 아래 순서로 실제 처리를 돌리세요:`);
  console.log(`  npm run extraction:process -- --limit=${processed}`);
  console.log(`  npm run clauses:process -- --limit=${processed}`);
  console.log(`  npm run ai:process-embeddings -- --limit=${processed}`);
}

main()
  .catch((error: unknown) => {
    console.error("데모 계약 보강 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
