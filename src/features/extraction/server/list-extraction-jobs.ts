import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findExtractionJobsByContract } from "@/server/repositories/extraction-job-repository";
import { prisma } from "@/server/db/client";

export interface ExtractionJobListItem {
  id: string;
  status: string;
  attempt: number;
  contractFileId: string;
  contractFileName: string;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  errorCode: string | null;
}

export interface ListExtractionJobsParams {
  userId: string;
  organizationId: string;
  contractId: string;
}

export async function listExtractionJobs(
  params: ListExtractionJobsParams
): Promise<ExtractionJobListItem[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const jobs = await findExtractionJobsByContract({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
  });
  if (jobs.length === 0) {
    return [];
  }

  const fileIds = [...new Set(jobs.map((job) => job.contractFileId))];
  const userIds = [...new Set(jobs.map((job) => job.createdById))];

  const [files, users] = await Promise.all([
    prisma.contractFile.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, originalName: true },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const fileNameById = new Map(files.map((file) => [file.id, file.originalName]));
  const userNameById = new Map(users.map((user) => [user.id, user.name]));

  return jobs.map((job) => ({
    id: job.id,
    status: job.status,
    attempt: job.attempt,
    contractFileId: job.contractFileId,
    contractFileName: fileNameById.get(job.contractFileId) ?? "(삭제된 파일)",
    createdById: job.createdById,
    createdByName: userNameById.get(job.createdById) ?? "알 수 없음",
    createdAt: job.createdAt,
    errorCode: job.errorCode,
  }));
}
