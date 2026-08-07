-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "canaryUsed" BOOLEAN;

-- AlterTable
ALTER TABLE "ai_usage_records" ADD COLUMN     "canaryUsed" BOOLEAN NOT NULL DEFAULT false;
