"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeMemberRoleAction } from "@/features/members/server/change-member-role-action";

const ROLE_ITEMS = { MEMBER: "MEMBER", OWNER: "OWNER" };

export function ChangeRoleSelect({
  membershipId,
  role,
}: {
  membershipId: string;
  role: "OWNER" | "MEMBER";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(nextRole: string | null) {
    if (!nextRole || nextRole === role) return;
    setError(null);
    startTransition(async () => {
      const result = await changeMemberRoleAction(membershipId, { role: nextRole });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("역할을 변경했습니다.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Select items={ROLE_ITEMS} value={role} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-28" aria-label="역할 변경">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ROLE_ITEMS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
