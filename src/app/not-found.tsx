import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">404</h1>
      <p className="text-sm text-muted-foreground">요청하신 페이지를 찾을 수 없습니다.</p>
      <Button nativeButton={false} render={<Link href="/dashboard" />}>
        대시보드로 이동
      </Button>
    </div>
  );
}
