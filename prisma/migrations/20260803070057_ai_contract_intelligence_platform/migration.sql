-- CreateEnum
CREATE TYPE "EmbeddingJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "clause_embeddings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractClauseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "checksum" TEXT NOT NULL,
    "embeddingVersion" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clause_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractClauseId" TEXT NOT NULL,
    "status" "EmbeddingJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "inputChecksum" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embedding_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_message_citations" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "contractClauseId" TEXT,
    "contractId" TEXT NOT NULL,
    "contractTitle" TEXT NOT NULL,
    "clauseNumber" TEXT,
    "evidenceText" VARCHAR(500) NOT NULL,
    "score" DECIMAL(6,5),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_message_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_search_patterns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patternType" TEXT NOT NULL,
    "patternKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_search_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clause_embeddings_organizationId_contractClauseId_isLatest_idx" ON "clause_embeddings"("organizationId", "contractClauseId", "isLatest");

-- CreateIndex
CREATE INDEX "clause_embeddings_organizationId_isLatest_idx" ON "clause_embeddings"("organizationId", "isLatest");

-- CreateIndex
CREATE UNIQUE INDEX "clause_embeddings_contractClauseId_embeddingVersion_key" ON "clause_embeddings"("contractClauseId", "embeddingVersion");

-- CreateIndex
CREATE INDEX "embedding_jobs_status_createdAt_idx" ON "embedding_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "embedding_jobs_organizationId_status_idx" ON "embedding_jobs"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_jobs_contractClauseId_inputChecksum_key" ON "embedding_jobs"("contractClauseId", "inputChecksum");

-- CreateIndex
CREATE INDEX "ai_conversations_organizationId_userId_updatedAt_idx" ON "ai_conversations"("organizationId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_message_citations_messageId_idx" ON "ai_message_citations"("messageId");

-- CreateIndex
CREATE INDEX "ai_search_patterns_organizationId_patternType_count_idx" ON "ai_search_patterns"("organizationId", "patternType", "count");

-- CreateIndex
CREATE UNIQUE INDEX "ai_search_patterns_organizationId_patternType_patternKey_key" ON "ai_search_patterns"("organizationId", "patternType", "patternKey");

-- AddForeignKey
ALTER TABLE "clause_embeddings" ADD CONSTRAINT "clause_embeddings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_embeddings" ADD CONSTRAINT "clause_embeddings_contractClauseId_fkey" FOREIGN KEY ("contractClauseId") REFERENCES "contract_clauses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embedding_jobs" ADD CONSTRAINT "embedding_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embedding_jobs" ADD CONSTRAINT "embedding_jobs_contractClauseId_fkey" FOREIGN KEY ("contractClauseId") REFERENCES "contract_clauses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_message_citations" ADD CONSTRAINT "ai_message_citations_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_search_patterns" ADD CONSTRAINT "ai_search_patterns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
