import "dotenv/config";

import { createClauseSegmentationJob } from "../src/features/clauses/server/create-clause-segmentation-job";
import { prisma } from "../src/server/db/client";

/**
 * Extraction completing does NOT auto-enqueue clause segmentation (same
 * "request is a separate explicit step" pattern as extraction itself not
 * being auto-enqueued on upload - see create-clause-segmentation-job.ts).
 * This walks every completed extracted document under a "DEMO-" contract
 * and requests segmentation for it, mirroring what the "조항 분해 요청"
 * button in the UI does. Skips contracts that already have a segmentation
 * job so re-running is safe.
 */

const ORG_SLUG = "senecial-dev";
const OWNER_EMAIL = "owner@example.com";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run in NODE_ENV=production.");
  }

  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) throw new Error(`Organization "${ORG_SLUG}" not found.`);
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!owner) throw new Error(`User "${OWNER_EMAIL}" not found.`);

  const demoContracts = await prisma.contract.findMany({
    where: { organizationId: organization.id, contractNumber: { startsWith: "DEMO-" } },
    select: { id: true },
  });

  const documents = await prisma.contractExtractedDocument.findMany({
    where: {
      organizationId: organization.id,
      contractId: { in: demoContracts.map((c) => c.id) },
      segmentationJobs: { none: {} },
    },
    select: { id: true, contractId: true },
  });

  if (documents.length === 0) {
    console.log("분해 요청이 필요한 추출 문서가 없습니다.");
    return;
  }

  console.log(`${documents.length}건의 추출 문서에 조항 분해 작업을 요청합니다...`);

  let created = 0;
  for (const doc of documents) {
    await createClauseSegmentationJob({
      userId: owner.id,
      organizationId: organization.id,
      contractId: doc.contractId,
      input: { extractedDocumentId: doc.id },
    });
    created += 1;
    if (created % 20 === 0) {
      console.log(`  ...${created}/${documents.length}건 요청`);
    }
  }

  console.log(`완료: ${created}건 조항 분해 작업 등록. 이제 "npm run clauses:process -- --limit=${created}" 를 실행하세요.`);
}

main()
  .catch((error: unknown) => {
    console.error("조항 분해 작업 등록 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
