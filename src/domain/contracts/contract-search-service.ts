import type { ContractStatus, ContractType } from "@/generated/prisma/enums";

export interface ContractSearchParams {
  organizationId: string;
  query?: string;
  contractType?: ContractType;
  /** Filters on the *computed* status, not the raw stored column. */
  displayStatus?: ContractStatus;
  autoRenewal?: boolean;
  counterpartyId?: string;
  sortBy?: "createdAt" | "updatedAt" | "title" | "endDate";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  /** Injected for testability - defaults to `new Date()`. */
  now?: Date;
}

export interface ContractSearchResultItem {
  id: string;
  title: string;
  contractNumber: string | null;
  contractType: ContractType;
  /** As persisted in the DB. */
  storedStatus: ContractStatus;
  /** Time-computed status to actually show the user. */
  displayStatus: ContractStatus;
  startDate: Date | null;
  endDate: Date | null;
  signedDate: Date | null;
  autoRenewal: boolean;
  /** Serialized as a string - never a JS float - see amount handling notes. */
  amount: string | null;
  currency: string | null;
  counterparty: { id: string; name: string } | null;
  updatedAt: Date;
}

export interface ContractSearchResult {
  items: ContractSearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ContractSearchService {
  search(params: ContractSearchParams): Promise<ContractSearchResult>;
}
