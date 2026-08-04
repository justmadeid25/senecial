import type { ContractStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { CONTRACT_STATUS_LABELS } from "@/domain/contracts/labels";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<ContractStatus, string> = {
  DRAFT: "",
  ACTIVE: "",
  EXPIRING: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  EXPIRED: "",
  TERMINATED: "",
  ARCHIVED: "",
};

const STATUS_VARIANT: Record<ContractStatus, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "secondary",
  ACTIVE: "default",
  EXPIRING: "outline",
  EXPIRED: "destructive",
  TERMINATED: "outline",
  ARCHIVED: "outline",
};

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn(STATUS_STYLES[status])}>
      {CONTRACT_STATUS_LABELS[status]}
    </Badge>
  );
}
