import type { DefaultSession } from "next-auth";

import type { MembershipRole } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: MembershipRole;
      /** Phase 9 §22 - compared against the live User.sessionVersion on every requireAuthenticatedUser() call; a mismatch means this JWT predates a password reset/security event and must be treated as invalidated. */
      sessionVersion: number;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId: string;
    role: MembershipRole;
    sessionVersion: number;
  }
}

// `next-auth`'s AuthConfig callbacks are typed against the JWT interface
// from "@auth/core/jwt" (next-auth/jwt only re-exports it), so that is the
// module that must actually be augmented for the `session`/`jwt` callback
// parameter types to pick up these fields.
declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    organizationId: string;
    role: MembershipRole;
    sessionVersion: number;
  }
}
