import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MembershipRole } from "@/generated/prisma/enums";
import { computeHashingTrickEmbedding } from "@/domain/ai/hashing-trick-embedding";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { hybridSearchClauses } from "@/features/ai/server/hybrid-search-clauses";
import {
  bulkInsertSyntheticClauses,
  createBenchmarkSeedDocuments,
  generateSyntheticClauseText,
} from "@/features/ai/server/seed-synthetic-benchmark-data";
import { ApplicationCosineClauseSearchProvider } from "@/server/services/ai/vector-search/application-cosine-clause-search-provider";
import { PgVectorClauseSearchProvider } from "@/server/services/ai/vector-search/pgvector-clause-search-provider";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "vector-search-benchmark.local";
const HNSW_INDEX_NAME = "clause_embeddings_vector_native_hnsw_idx";
const N_SEED_DOCS = 5;
const N_QUERIES_PER_LATENCY_MEASUREMENT = 10;
const EMBEDDING_PROVIDER = "development";
const EMBEDDING_MODEL = "hashing-trick-v1";

function parseArgs() {
  const args = process.argv.slice(2);
  const targetArg = args.find((arg) => arg.startsWith("--target="));
  const target = targetArg ? Number(targetArg.split("=")[1]) : 5000;
  return { target: Number.isFinite(target) && target > 0 ? target : 5000 };
}

function percentile(sortedMs: number[], p: number): number {
  const index = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[index]!;
}

async function measureLatency(fn: () => Promise<unknown>, count: number): Promise<{ meanMs: number; p95Ms: number }> {
  const samples: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const meanMs = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  return { meanMs, p95Ms: percentile(samples, 95) };
}

async function main() {
  const { target } = parseArgs();
  console.log(`벡터 검색 성능 벤치마크 시작 (목표 조항 수: ${target}건)`);

  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  const org = await prisma.organization.create({
    data: { name: "Vector Search Benchmark Org", slug: `vector-search-benchmark-${Date.now()}` },
  });
  const owner = await prisma.user.create({
    data: {
      name: "Vector Search Benchmark Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const createdFileStorageKeys: string[] = [];

  try {
    console.log(`시드 문서 ${N_SEED_DOCS}건 생성 중 (실제 추출/분해 파이프라인 사용)...`);
    const seedDocs = await createBenchmarkSeedDocuments({ organizationId: org.id, userId: owner.id, count: N_SEED_DOCS });

    console.log(`합성 조항 ${target}건 대량 삽입 중...`);
    const insertResult = await bulkInsertSyntheticClauses({
      organizationId: org.id,
      seedDocs,
      targetCount: target,
      onProgress: (inserted, elapsedMs) => {
        if (inserted % 5000 === 0 || inserted === target) {
          console.log(`  진행: ${inserted}/${target}건 (${(elapsedMs / 1000).toFixed(1)}초 경과)`);
        }
      },
    });
    console.log(
      `삽입 완료: 조항 ${insertResult.clausesInserted}건, 임베딩 ${insertResult.embeddingsInserted}건, ` +
        `소요 ${(insertResult.elapsedMs / 1000).toFixed(1)}초`
    );

    console.log("ANALYZE 실행 중...");
    await prisma.$executeRawUnsafe(`ANALYZE "clause_embeddings"`);

    const sampleQueries = Array.from({ length: N_QUERIES_PER_LATENCY_MEASUREMENT }, (_, i) =>
      generateSyntheticClauseText(i * 137) // arbitrary stride, not the same as insertion order
    );
    const queryVectors = sampleQueries.map((q) => computeHashingTrickEmbedding(normalizeClauseText(q), VECTOR_NATIVE_DIMENSION));

    const applicationProvider = new ApplicationCosineClauseSearchProvider();
    const pgvectorProvider = new PgVectorClauseSearchProvider();

    console.log("애플리케이션 cosine (JS 전체 스캔) 지연시간 측정 중...");
    let qi = 0;
    const applicationLatency = await measureLatency(async () => {
      await applicationProvider.search({
        organizationId: org.id,
        queryVector: queryVectors[qi % queryVectors.length]!,
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 10,
      });
      qi += 1;
    }, N_QUERIES_PER_LATENCY_MEASUREMENT);

    console.log("pgvector (HNSW 인덱스) 지연시간 측정 중...");
    qi = 0;
    const pgvectorIndexedLatency = await measureLatency(async () => {
      await pgvectorProvider.search({
        organizationId: org.id,
        queryVector: queryVectors[qi % queryVectors.length]!,
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 10,
      });
      qi += 1;
    }, N_QUERIES_PER_LATENCY_MEASUREMENT);

    // §Phase 12.1 Part 18 - the SAME raw query shape, once with the
    // planner free to use the HNSW index and once with it forced off, so
    // the index-vs-seq-scan comparison is apples-to-apples (isolated from
    // PgVectorClauseSearchProvider's own extra eligibility-lookup
    // round-trip, which is measured separately above as "전체 provider").
    const rawIndexedQuery = (queryVectorText: string) =>
      prisma.$queryRawUnsafe(
        `SELECT ce."contractClauseId" FROM "clause_embeddings" ce
         WHERE ce."organizationId" = $1 AND ce."isLatest" = true AND ce."vectorNative" IS NOT NULL
         ORDER BY ce."vectorNative" <=> $2::vector LIMIT 10`,
        org.id,
        queryVectorText
      );

    console.log("pgvector (원시 쿼리, HNSW 인덱스) 지연시간 측정 중...");
    qi = 0;
    const pgvectorRawIndexedLatency = await measureLatency(async () => {
      await rawIndexedQuery(`[${queryVectors[qi % queryVectors.length]!.join(",")}]`);
      qi += 1;
    }, N_QUERIES_PER_LATENCY_MEASUREMENT);

    console.log("pgvector (원시 쿼리, 순차 스캔 강제) 지연시간 측정 중...");
    qi = 0;
    const pgvectorSeqScanLatency = await measureLatency(async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL enable_indexscan = off`);
        await tx.$executeRawUnsafe(`SET LOCAL enable_bitmapscan = off`);
        const queryVectorText = `[${queryVectors[qi % queryVectors.length]!.join(",")}]`;
        await tx.$queryRawUnsafe(
          `SELECT ce."contractClauseId" FROM "clause_embeddings" ce
           WHERE ce."organizationId" = $1 AND ce."isLatest" = true AND ce."vectorNative" IS NOT NULL
           ORDER BY ce."vectorNative" <=> $2::vector LIMIT 10`,
          org.id,
          queryVectorText
        );
      });
      qi += 1;
    }, N_QUERIES_PER_LATENCY_MEASUREMENT);

    console.log("hybrid search (keyword + vector) 지연시간 측정 중...");
    const hybridLatency = await measureLatency(async () => {
      await hybridSearchClauses({ organizationId: org.id, question: "대금지급 조건은 어떻게 되나요?", topK: 10 });
    }, N_QUERIES_PER_LATENCY_MEASUREMENT);

    console.log("EXPLAIN (ANALYZE, BUFFERS) 실행 중...");
    const explainQueryVectorText = `[${queryVectors[0]!.join(",")}]`;
    const explainRows = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT ce."contractClauseId" FROM "clause_embeddings" ce
       WHERE ce."organizationId" = $1 AND ce."isLatest" = true AND ce."vectorNative" IS NOT NULL
       ORDER BY ce."vectorNative" <=> $2::vector LIMIT 10`,
      org.id,
      explainQueryVectorText
    );
    const explainPlan = explainRows.map((row) => row["QUERY PLAN"]).join("\n");
    const indexUsed = explainPlan.includes(HNSW_INDEX_NAME) || /Index.*Scan/i.test(explainPlan);

    console.log("인덱스 재생성 시간 측정 중...");
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${HNSW_INDEX_NAME}"`);
    const indexBuildStart = performance.now();
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "${HNSW_INDEX_NAME}" ON "clause_embeddings" USING hnsw ("vectorNative" vector_cosine_ops)`
    );
    const indexBuildMs = performance.now() - indexBuildStart;

    const indexSizeRows = await prisma.$queryRawUnsafe<Array<{ size: bigint }>>(
      `SELECT pg_relation_size('"${HNSW_INDEX_NAME}"')::bigint AS size`
    );
    const indexSizeBytes = Number(indexSizeRows[0]!.size);

    const report = [
      `# pgvector 검색 성능 벤치마크`,
      ``,
      `- 생성 시각: ${new Date().toISOString()}`,
      `- 조항 수: ${insertResult.clausesInserted}건 (목표 ${target}건)`,
      `- 조직 수: 1 (벤치마크 전용), 시드 문서: ${N_SEED_DOCS}건`,
      `- 측정 질문 수: ${N_QUERIES_PER_LATENCY_MEASUREMENT}개 (각 지연시간은 평균/p95)`,
      ``,
      `## 지연시간`,
      ``,
      `| 경로 | 평균 (ms) | p95 (ms) |`,
      `| --- | --- | --- |`,
      `| 애플리케이션 cosine (전체 provider, JS 전체 스캔) | ${applicationLatency.meanMs.toFixed(2)} | ${applicationLatency.p95Ms.toFixed(2)} |`,
      `| pgvector (전체 provider, HNSW 인덱스 - eligibility 조회 포함 실제 애플리케이션 경로) | ${pgvectorIndexedLatency.meanMs.toFixed(2)} | ${pgvectorIndexedLatency.p95Ms.toFixed(2)} |`,
      `| pgvector (원시 쿼리, HNSW 인덱스) | ${pgvectorRawIndexedLatency.meanMs.toFixed(2)} | ${pgvectorRawIndexedLatency.p95Ms.toFixed(2)} |`,
      `| pgvector (원시 쿼리, 순차 스캔 강제) | ${pgvectorSeqScanLatency.meanMs.toFixed(2)} | ${pgvectorSeqScanLatency.p95Ms.toFixed(2)} |`,
      `| hybrid search (keyword + vector, 전체 파이프라인, 캐시 미사용 경로 포함) | ${hybridLatency.meanMs.toFixed(2)} | ${hybridLatency.p95Ms.toFixed(2)} |`,
      ``,
      `"원시 쿼리" 두 행은 PgVectorClauseSearchProvider의 organizationId별 latest-segmentation-revision 조회 오버헤드를 제외한, 동일한 distance 쿼리 자체의 인덱스 유무 비교입니다. "전체 provider" 행들은 실제 애플리케이션이 호출하는 전체 경로(eligibility 조회 포함)의 체감 지연시간입니다.`,
      ``,
      `## 인덱스`,
      ``,
      `- HNSW 인덱스 사용 여부(EXPLAIN): ${indexUsed ? "예" : "아니오 (이 데이터 규모에서는 정상일 수 있음)"}`,
      `- 인덱스 재생성 시간: ${(indexBuildMs / 1000).toFixed(2)}초`,
      `- 인덱스 크기: ${(indexSizeBytes / 1024 / 1024).toFixed(2)} MB`,
      ``,
      `## EXPLAIN (ANALYZE, BUFFERS) 원문`,
      ``,
      "```",
      explainPlan,
      "```",
    ].join("\n");

    const reportPath = path.join(process.cwd(), "reports", "vector-search-benchmark.md");
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report, "utf8");

    console.log("\n" + report);
    console.log(`\n리포트 저장 위치: ${reportPath}`);
  } finally {
    console.log("\n정리 중 (시드 데이터 삭제)...");
    const storageDriver = getStorageDriver();
    for (const key of createdFileStorageKeys) {
      await storageDriver.delete(key).catch(() => {});
    }
    await prisma.clauseEmbedding.deleteMany({ where: { organizationId: org.id } });
    await prisma.embeddingJob.deleteMany({ where: { organizationId: org.id } });
    await prisma.contractClause.deleteMany({ where: { organizationId: org.id } });
    await prisma.contractSection.deleteMany({ where: { organizationId: org.id } });
    await prisma.clauseSegmentationJob.deleteMany({ where: { organizationId: org.id } });
    await prisma.contractExtractedDocument.deleteMany({ where: { organizationId: org.id } });
    await prisma.contractExtractionJob.deleteMany({ where: { organizationId: org.id } });
    await prisma.contractFile.deleteMany({ where: { organizationId: org.id } });
    await prisma.contract.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
    console.log("정리 완료.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("벤치마크 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
