import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Recursively lists every file under `root`, verifying each resolved path
 * stays within `root` (defense in depth against a hypothetical crafted
 * archive entry - tar itself already refuses to write outside the
 * `--directory` target by default, this is a second, cheap check on top).
 */
export async function listFilesRecursive(root: string): Promise<string[]> {
  const resolvedRoot = path.resolve(root);
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const resolved = path.resolve(fullPath);
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`복원된 항목이 대상 디렉터리 밖을 가리킵니다: ${entry.name}`);
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(resolvedRoot);
  return files;
}
