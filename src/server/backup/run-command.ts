import { spawn } from "node:child_process";

const MAX_CAPTURED_OUTPUT = 4000;

export interface RunCommandResult {
  exitCode: number;
  stderr: string;
}

/**
 * Runs an external binary (pg_dump/pg_restore/tar) with args passed as a
 * literal array (never interpolated into a shell string, so no shell
 * injection is possible regardless of what a path/filename contains) and
 * an explicit env object merged over a minimal base - callers decide
 * exactly what environment variables the child sees (see
 * database-url.ts's toPgEnv()), so a credential never has to pass through
 * a CLI argument that `ps`/Task Manager could reveal.
 */
export function runCommand(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; cwd?: string } = {}
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) {
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (error) => {
      reject(new Error(`"${command}" 실행에 실패했습니다: ${error.message}`));
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? -1, stderr: stderr.slice(0, MAX_CAPTURED_OUTPUT) });
    });
  });
}
