import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { generateIdentity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AgeBackupEncryptor } from "@/server/backup/age-backup-encryptor";

/** getBackupEncryptor()/isUsingNoopBackupEncryptor()/getBackupEncryptionInfo() cache their result at module scope - a fresh import per scenario avoids one test's cached encryptor leaking into the next (same pattern as extraction-provider-guard.test.ts). */
async function loadEncryptorModule() {
  vi.resetModules();
  return import("@/server/backup/get-backup-encryptor");
}

describe("AgeBackupEncryptor (Phase 10C §2/§4/§7)", () => {
  let workDir: string;
  let recipient: string;
  let identity: string;
  let otherIdentity: string;
  let plaintextPath: string;
  const plaintextContent = Buffer.concat([Buffer.from("backup encryption test fixture\n"), randomBytes(256)]);

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "senecial-age-test-"));
    identity = await generateIdentity();
    recipient = await identityToRecipient(identity);
    otherIdentity = await generateIdentity();

    plaintextPath = path.join(workDir, "plaintext.bin");
    await writeFile(plaintextPath, plaintextContent);
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("round-trips: encrypt then decrypt reproduces the exact original bytes", async () => {
    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    const decryptedPath = path.join(workDir, `${randomUUID()}.dec`);

    await encryptor.encrypt(plaintextPath, encryptedPath);
    await encryptor.decrypt(encryptedPath, decryptedPath);

    const decrypted = await readFile(decryptedPath);
    expect(decrypted.equals(plaintextContent)).toBe(true);

    const encrypted = await readFile(encryptedPath);
    expect(encrypted.equals(plaintextContent)).toBe(false); // never plaintext on disk
  });

  it("rejects decryption with the wrong identity (wrong key)", async () => {
    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    await encryptor.encrypt(plaintextPath, encryptedPath);

    const wrongEncryptor = new AgeBackupEncryptor([recipient], otherIdentity);
    const decryptedPath = path.join(workDir, `${randomUUID()}.dec`);

    await expect(wrongEncryptor.decrypt(encryptedPath, decryptedPath)).rejects.toThrow(/복호화\(age\)에 실패/);
  });

  it("rejects a tampered ciphertext body", async () => {
    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    await encryptor.encrypt(plaintextPath, encryptedPath);

    const bytes = await readFile(encryptedPath);
    const tampered = Buffer.from(bytes);
    const flipIndex = tampered.length - 10;
    tampered[flipIndex] = tampered[flipIndex]! ^ 0xff; // flip a byte deep in the STREAM ciphertext/tag region
    const tamperedPath = path.join(workDir, `${randomUUID()}.tampered`);
    await writeFile(tamperedPath, tampered);

    const decryptedPath = path.join(workDir, `${randomUUID()}.dec`);
    await expect(encryptor.decrypt(tamperedPath, decryptedPath)).rejects.toThrow(/복호화\(age\)에 실패/);
  });

  it("rejects a ciphertext with a corrupted authentication tag (last bytes of the final STREAM chunk)", async () => {
    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    await encryptor.encrypt(plaintextPath, encryptedPath);

    const bytes = await readFile(encryptedPath);
    const tampered = Buffer.from(bytes);
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = tampered[lastIndex]! ^ 0xff; // the very last byte is part of the final chunk's Poly1305 tag
    const tamperedPath = path.join(workDir, `${randomUUID()}.tag-tampered`);
    await writeFile(tamperedPath, tampered);

    const decryptedPath = path.join(workDir, `${randomUUID()}.dec`);
    await expect(encryptor.decrypt(tamperedPath, decryptedPath)).rejects.toThrow(/복호화\(age\)에 실패/);
  });

  it("never reuses the same ciphertext bytes for the same plaintext (fresh nonce/ephemeral key per encryption)", async () => {
    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const firstPath = path.join(workDir, `${randomUUID()}.enc`);
    const secondPath = path.join(workDir, `${randomUUID()}.enc`);

    await encryptor.encrypt(plaintextPath, firstPath);
    await encryptor.encrypt(plaintextPath, secondPath);

    const first = await readFile(firstPath);
    const second = await readFile(secondPath);
    expect(first.equals(second)).toBe(false);
  });

  it("refuses to construct with zero recipients", () => {
    expect(() => new AgeBackupEncryptor([], identity)).toThrow(/BACKUP_AGE_RECIPIENTS/);
  });

  it("refuses to decrypt when no identity was configured (encrypt-only host)", async () => {
    const encryptOnly = new AgeBackupEncryptor([recipient], undefined);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    await encryptOnly.encrypt(plaintextPath, encryptedPath);

    await expect(encryptOnly.decrypt(encryptedPath, path.join(workDir, `${randomUUID()}.dec`))).rejects.toThrow(
      /BACKUP_AGE_IDENTITY/
    );
  });

  it("never leaks the identity or recipient key material into a thrown error message", async () => {
    const wrongEncryptor = new AgeBackupEncryptor([recipient], otherIdentity);
    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    await encryptor.encrypt(plaintextPath, encryptedPath);

    try {
      await wrongEncryptor.decrypt(encryptedPath, path.join(workDir, `${randomUUID()}.dec`));
      expect.unreachable("expected decrypt to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(identity);
      expect(message).not.toContain(otherIdentity);
      expect(message).not.toContain(recipient);
    }
  });

  it("leaves no partial/incomplete file behind on a failed decrypt, and never leaves a stray .tmp- file", async () => {
    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    await encryptor.encrypt(plaintextPath, encryptedPath);

    const wrongEncryptor = new AgeBackupEncryptor([recipient], otherIdentity);
    const decryptedPath = path.join(workDir, `cleanup-target-${randomUUID()}.dec`);

    await expect(wrongEncryptor.decrypt(encryptedPath, decryptedPath)).rejects.toThrow();

    const entries = await readdir(workDir);
    expect(entries).not.toContain(path.basename(decryptedPath)); // never created
    expect(entries.some((name) => name.includes(".tmp-"))).toBe(false); // temp file cleaned up
  });

  it("streams a multi-megabyte fixture correctly (not loaded whole into memory)", async () => {
    const largePath = path.join(workDir, "large-fixture.bin");
    const largeContent = randomBytes(5 * 1024 * 1024); // 5 MiB
    await writeFile(largePath, largeContent);

    const encryptor = new AgeBackupEncryptor([recipient], identity);
    const encryptedPath = path.join(workDir, `${randomUUID()}.enc`);
    const decryptedPath = path.join(workDir, `${randomUUID()}.dec`);

    await encryptor.encrypt(largePath, encryptedPath);
    await encryptor.decrypt(encryptedPath, decryptedPath);

    const decrypted = await readFile(decryptedPath);
    expect(decrypted.equals(largeContent)).toBe(true);
  }, 30_000);
});

describe("getBackupEncryptor() - production guard (§6)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns NoopBackupEncryptor outside production with no override needed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BACKUP_ENCRYPTION_PROVIDER", "noop");
    const { getBackupEncryptor, isUsingNoopBackupEncryptor } = await loadEncryptorModule();

    expect(() => getBackupEncryptor()).not.toThrow();
    expect(isUsingNoopBackupEncryptor()).toBe(true);
  });

  it("throws in production for the noop provider without the deprecated override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKUP_ENCRYPTION_PROVIDER", "noop");
    const { getBackupEncryptor } = await loadEncryptorModule();

    expect(() => getBackupEncryptor()).toThrow(/BACKUP_ENCRYPTION_PROVIDER=noop/);
  });

  it("allows noop in production only with the explicit deprecated ALLOW_UNENCRYPTED_BACKUP=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKUP_ENCRYPTION_PROVIDER", "noop");
    vi.stubEnv("ALLOW_UNENCRYPTED_BACKUP", "true");
    const { getBackupEncryptor } = await loadEncryptorModule();

    expect(() => getBackupEncryptor()).not.toThrow();
  });

  it("the real age provider needs no override at all in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKUP_ENCRYPTION_PROVIDER", "age");
    vi.stubEnv("BACKUP_AGE_RECIPIENTS", "age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqspq6h3f2z"); // syntactically age-shaped, never actually used to encrypt in this test
    const { getBackupEncryptor } = await loadEncryptorModule();

    expect(() => getBackupEncryptor()).not.toThrow();
  });

  it("rejects an unsupported provider value", async () => {
    vi.stubEnv("BACKUP_ENCRYPTION_PROVIDER", "some-unimplemented-provider");
    const { getBackupEncryptor } = await loadEncryptorModule();

    expect(() => getBackupEncryptor()).toThrow(/지원하지 않는 BACKUP_ENCRYPTION_PROVIDER/);
  });

  it("getBackupEncryptionInfo() never exposes key material - provider/algorithm/keyId only", async () => {
    vi.stubEnv("BACKUP_ENCRYPTION_PROVIDER", "age");
    vi.stubEnv("BACKUP_AGE_RECIPIENTS", "age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqspq6h3f2z");
    vi.stubEnv("BACKUP_AGE_KEY_ID", "test-key-label-2026");
    const { getBackupEncryptor, getBackupEncryptionInfo } = await loadEncryptorModule();
    getBackupEncryptor();

    const info = getBackupEncryptionInfo();
    expect(info.provider).toBe("age");
    expect(info.algorithm).toMatch(/age-encryption\.org/);
    expect(info.keyId).toBe("test-key-label-2026");
    expect(JSON.stringify(info)).not.toContain("AGE-SECRET-KEY");
  });
});
