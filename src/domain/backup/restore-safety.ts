import { parseDatabaseUrl } from "./database-url";

/** True if two DATABASE_URLs point at the same host+port+database (credentials/query params ignored). */
export function isSameDatabaseTarget(a: string, b: string): boolean {
  const pa = parseDatabaseUrl(a);
  const pb = parseDatabaseUrl(b);
  return (
    pa.host.toLowerCase() === pb.host.toLowerCase() &&
    pa.port === pb.port &&
    pa.database === pb.database
  );
}

/**
 * Phase 9 §12/§14 - a restore must never silently land on the same
 * database this process is itself configured to use (DATABASE_URL) when
 * running in production, since that is almost always a mistake (the
 * intended target is a fresh/empty database, e.g. during disaster
 * recovery) rather than an intentional in-place overwrite. Throws unless
 * the caller has explicitly opted in.
 */
export function assertRestoreTargetIsSafe(params: {
  targetDatabaseUrl: string;
  primaryDatabaseUrl: string | undefined;
  isProduction: boolean;
  allowProductionOverwrite: boolean;
}): void {
  if (!params.isProduction) {
    return;
  }
  if (params.allowProductionOverwrite) {
    return;
  }
  if (params.primaryDatabaseUrl && isSameDatabaseTarget(params.targetDatabaseUrl, params.primaryDatabaseUrl)) {
    throw new Error(
      "운영 환경에서 이 데이터베이스로의 복구는 차단되었습니다 (대상이 DATABASE_URL과 동일). " +
        "정말로 운영 DB를 덮어써야 한다면 --allow-production-overwrite 플래그를 명시적으로 전달하십시오."
    );
  }
}
