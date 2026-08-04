export interface PgConnectionParams {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
}

/**
 * Parses DATABASE_URL into discrete libpq environment variables
 * (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE) so backup/restore
 * scripts can pass credentials to pg_dump/pg_restore via the child
 * process's environment rather than as a CLI argument - `ps`/Task Manager
 * can reveal another process's full command line, but not its environment,
 * on the same host. This is the reason backup/restore scripts never log
 * or pass DATABASE_URL itself (Phase 9 §9/§12).
 */
export function parseDatabaseUrl(databaseUrl: string): PgConnectionParams {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL이 올바른 URL 형식이 아닙니다.");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL은 postgresql:// 형식이어야 합니다.");
  }

  const database = url.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error("DATABASE_URL에 데이터베이스 이름이 없습니다.");
  }

  return {
    host: url.hostname || "localhost",
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslmode: url.searchParams.get("sslmode") ?? undefined,
  };
}

/** Builds the env object to pass to spawn() - never merges in the raw DATABASE_URL string itself. */
export function toPgEnv(params: PgConnectionParams): Record<string, string> {
  const env: Record<string, string> = {
    PGHOST: params.host,
    PGPORT: params.port,
    PGUSER: params.user,
    PGPASSWORD: params.password,
    PGDATABASE: params.database,
  };
  if (params.sslmode) {
    env.PGSSLMODE = params.sslmode;
  }
  return env;
}
