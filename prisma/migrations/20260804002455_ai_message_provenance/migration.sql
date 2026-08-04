-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "aiConfigChecksum" TEXT,
ADD COLUMN     "aiConfigVersion" TEXT,
ADD COLUMN     "citationValidatorVersion" TEXT,
ADD COLUMN     "embeddingVersion" TEXT,
ADD COLUMN     "promptTemplateVersion" TEXT,
ADD COLUMN     "vectorSearchProvider" TEXT;
