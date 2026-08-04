import { createRequire } from "node:module";
import path from "node:path";

/**
 * Resolves an installed package's own CLI entry script and returns an
 * absolute path suitable for `spawn(process.execPath, [entry, ...args])`.
 * Deliberately never spawns the package name itself (`spawn("prisma", ...)`,
 * `spawn("playwright", ...)`, `spawn("tsx", ...)`) - on Windows those
 * resolve to `.cmd`/`.ps1` shims that `child_process.spawn()` cannot
 * execute directly without `shell: true`, which this codebase's shared
 * `run-command.ts` deliberately never sets (see its own docstring on
 * passing args as a literal array, never through a shell). Running the
 * resolved script directly under the current `node` binary works
 * identically on every platform with no shell involved at all.
 */
export function resolvePackageBinEntry(packageName: string, binName: string = packageName): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = require(packageJsonPath) as { bin?: string | Record<string, string> };

  const binField = packageJson.bin;
  const relativeBinPath =
    typeof binField === "string" ? binField : binField?.[binName];

  if (!relativeBinPath) {
    throw new Error(`"${packageName}"의 package.json에 bin 항목(${binName})을 찾을 수 없습니다.`);
  }

  return path.join(path.dirname(packageJsonPath), relativeBinPath);
}
