import type { JWT } from "@auth/core/jwt";
import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { verifyCredentials } from "@/features/auth/server/verify-credentials";
import { prisma } from "@/server/db/client";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      authorize: async (credentials) => {
        const verified = await verifyCredentials(credentials);
        if (!verified) {
          return null;
        }

        return {
          id: verified.userId,
          name: verified.name,
          email: verified.email,
          organizationId: verified.organizationId,
          role: verified.role,
          sessionVersion: verified.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.organizationId = user.organizationId;
        token.role = user.role;
        // §22 - the value at sign-in time. Never refreshed here (the jwt
        // callback only runs on sign-in/explicit update, not per request),
        // which is exactly why the *session* callback below re-reads the
        // live DB value on every auth() call instead of trusting this.
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      session.user.id = token.userId;
      session.user.organizationId = token.organizationId;
      session.user.role = token.role;
      session.user.sessionVersion = token.sessionVersion;
      return session;
    },
  },
  events: {
    // §Phase 15.1 - fires only on an actual sign-in (not on every session
    // read, which the JWT strategy would otherwise imply) - the minimal
    // funnel-step-12 ("returned on a later session/day") signal identified
    // by the Phase 15 audit. Best-effort by design: a failure here must
    // never block a successful login.
    async signIn({ user }) {
      const userId = user.id as string | undefined;
      const organizationId = (user as { organizationId?: string }).organizationId;
      if (!userId || !organizationId) {
        return;
      }
      try {
        await prisma.auditLog.create({
          data: {
            organizationId,
            userId,
            entityType: "User",
            entityId: userId,
            action: AUDIT_ACTIONS.USER_LOGIN,
            metadata: {},
          },
        });
      } catch {
        // best-effort - see docstring above.
      }
    },
  },
});
