import { hash, verify } from "@node-rs/argon2";

/**
 * Abstracts the password hashing algorithm so it never leaks into calling
 * code (registration/login services only depend on this interface).
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}

/**
 * Argon2id via @node-rs/argon2 (napi-rs prebuilt binaries, including
 * win32-x64-msvc - no node-gyp/native build toolchain required, unlike the
 * `argon2` package). Argon2id is OWASP's recommended default for password
 * hashing. All cost parameters are embedded in the output hash string, so
 * `verify()` does not need them passed back in.
 */
class Argon2PasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    return verify(passwordHash, password);
  }
}

export const passwordHasher: PasswordHasher = new Argon2PasswordHasher();
