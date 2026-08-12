import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { askQuestion } from "@/features/ai/server/ask-question";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { renderPrometheusMetrics } from "@/server/monitoring/metrics";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-prompt-cache-isolation-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Byte-identical contract TITLE and TEXT across both organizations - the
// only scenario that can actually distinguish "the prompt cache key
// includes organizationId" from "the prompt cache key merely differs
// because the content happened to differ" (every other tenant-isolation
// fixture in this codebase uses a distinguishing title/label, which would
// make this specific gap invisible).
const CONTRACT_TITLE = "표준 컨설팅 용역계약서";
const SAMPLE_LINES = [
  CONTRACT_TITLE,
  "",
  "제1조(계약 해지)",
  "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.",
];
const QUESTION = "계약을 해지하려면 어떻게 해야 하나요?";

interface OrgFixture {
  organizationId: string;
  ownerId: string;
  contractId: string;
}

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drain(fn: (workerId: string) => Promise<{ processed: boolean }>, label: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await fn(`prompt-cache-isolation-${label}-${attempt}`)).processed) return;
  }
}

async function seedOrgWithIdenticalContract(label: string, emailSuffix: string): Promise<OrgFixture> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Prompt Cache Isolation ${label} (${runId})`, slug: `prompt-cache-isolation-${emailSuffix}-${runId}` },
  });
  const owner = await prisma.user.create({
    data: {
      name: `Prompt Cache Isolation Owner ${label}`,
      email: `owner-${emailSuffix}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: organization.id, role: MembershipRole.OWNER } },
    },
  });

  // Deliberately the SAME title for both organizations.
  const contract = await createContract({
    userId: owner.id,
    organizationId: organization.id,
    input: { title: CONTRACT_TITLE, contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });

  const buffer = await buildDocxBuffer(SAMPLE_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    originalName: `prompt-cache-isolation-${emailSuffix}.docx`,
    mimeType: DOCX_MIME,
    buffer,
  });
  const extractionJob = await createExtractionJob({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    input: { contractFileId: uploaded.id },
  });
  await drain(processNextExtractionJob, `${emailSuffix}-extract`);

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    input: { extractedDocumentId: document.id },
  });
  await drain(processNextClauseSegmentationJob, `${emailSuffix}-segment`);
  await drain(processNextEmbeddingJob, `${emailSuffix}-embed`);

  return { organizationId: organization.id, ownerId: owner.id, contractId: contract.id };
}

async function cleanupOrg(fixture: OrgFixture, storageKeys: string[]) {
  const storageDriver = getStorageDriver();
  for (const key of storageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.contractClause.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractSection.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractFile.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contract.deleteMany({ where: { id: fixture.contractId } });
  await prisma.membership.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.organization.delete({ where: { id: fixture.organizationId } });
}

let orgA: OrgFixture;
let orgB: OrgFixture;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  orgA = await seedOrgWithIdenticalContract("Org A", "a");
  orgB = await seedOrgWithIdenticalContract("Org B", "b");
}, 60_000);

afterAll(async () => {
  await cleanupOrg(orgA, []);
  await cleanupOrg(orgB, []);
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

function promptCacheHitCount(): number {
  const output = renderPrometheusMetrics();
  const match = output.match(/senecial_ai_cache_hits_total\{cache="prompt"\} (\d+)/);
  return match ? Number(match[1]) : 0;
}

describe("§Security - prompt/LLM cache is org-scoped even for byte-identical contract content (Phase 14.1 §19/§21)", () => {
  it("Org A's first ask is a real cache MISS, and Org B's identical question is ALSO a real miss (never served from Org A's cache)", async () => {
    const before = promptCacheHitCount();

    const resultA = await askQuestion({ organizationId: orgA.organizationId, question: QUESTION });
    const afterA = promptCacheHitCount();
    expect(afterA).toBe(before); // Org A's own first call is a genuine miss, not a hit.

    const resultB = await askQuestion({ organizationId: orgB.organizationId, question: QUESTION });
    const afterB = promptCacheHitCount();
    // The critical assertion: Org B's IDENTICAL question, against
    // byte-identical contract content, must NOT register as a prompt-cache
    // HIT (which would mean Org B's request never reached the real
    // pipeline and instead reused an entry keyed without organizationId).
    expect(afterB).toBe(afterA);

    expect(resultA.sufficient).toBe(true);
    expect(resultB.sufficient).toBe(true);
    for (const citation of resultA.citations) {
      expect(citation.contractId).toBe(orgA.contractId);
    }
    for (const citation of resultB.citations) {
      expect(citation.contractId).toBe(orgB.contractId);
    }
  });

  it("Org A repeating its OWN question now gets a real cache HIT (proves the counter itself is working, not just always zero)", async () => {
    const before = promptCacheHitCount();
    await askQuestion({ organizationId: orgA.organizationId, question: QUESTION });
    const after = promptCacheHitCount();
    expect(after).toBeGreaterThan(before);
  });
});
