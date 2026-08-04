import type { JWT } from "@auth/core/jwt";
import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { verifyCredentials } from "@/features/auth/server/verify-credentials";

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
});
