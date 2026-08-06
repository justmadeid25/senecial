-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowExternalAiProcessing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dailyAiRequestLimit" INTEGER,
ADD COLUMN     "monthlyAiBudgetMinor" BIGINT,
ADD COLUMN     "monthlyAiRequestLimit" INTEGER;

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "operationType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "embeddingTokens" INTEGER,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "estimatedCostMinor" BIGINT,
    "currency" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "aiConfigVersion" TEXT NOT NULL,
    "aiConfigChecksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_records_organizationId_createdAt_idx" ON "ai_usage_records"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_records_provider_model_createdAt_idx" ON "ai_usage_records"("provider", "model", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_records_operationType_createdAt_idx" ON "ai_usage_records"("operationType", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
