import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import { AcceptInvitationButton } from "@/features/invitations/components/accept-invitation-button";
import { RegisterAndAcceptForm } from "@/features/invitations/components/register-and-accept-form";
import { getInvitationByToken } from "@/features/invitations/server/get-invitation-by-token";

export const metadata: Metadata = { title: "조직 초대 | Senecial" };

const STATUS_MESSAGES: Record<string, string> = {
  not_found: "유효하지 않은 초대 링크입니다.",
  revoked: "취소된 초대입니다.",
  accepted: "이미 수락된 초대입니다.",
  expired: "만료된 초대입니다. 초대한 사람에게 새 초대를 요청해 주세요.",
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await getInvitationByToken(token);

  if (invitation.status !== "valid") {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold">초대를 확인할 수 없습니다</h1>
        <p className="text-sm text-muted-foreground">{STATUS_MESSAGES[invitation.status]}</p>
        <Button className="w-full" nativeButton={false} render={<Link href="/login" />}>
          로그인으로 이동
        </Button>
      </div>
    );
  }

  const session = await auth();
  const roleLabel = invitation.role === "OWNER" ? "OWNER" : "MEMBER";

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">조직 초대</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{invitation.invitedByName}</span>님이
          &ldquo;{invitation.organizationName}&rdquo; 조직에 <strong>{roleLabel}</strong> 권한으로
          초대했습니다.
        </p>
        <p className="text-xs text-muted-foreground">초대 대상 이메일: {invitation.email}</p>
      </div>

      {session?.user?.id ? (
        session.user.email === invitation.email ? (
          <AcceptInvitationButton token={token} />
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-sm text-destructive">
              이 초대는 현재 로그인한 계정({session.user.email})의 이메일과 일치하지 않습니다.
            </p>
            <p className="text-sm text-muted-foreground">
              {invitation.email} 계정으로 로그아웃 후 다시 로그인하여 이 링크를 다시 열어주세요.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          <RegisterAndAcceptForm token={token} email={invitation.email} />
          <p className="text-center text-sm text-muted-foreground">
            이미 계정이 있으신가요?{" "}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              로그인
            </Link>{" "}
            후 이 초대 링크를 다시 열어 수락해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
