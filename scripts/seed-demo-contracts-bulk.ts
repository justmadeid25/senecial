import "dotenv/config";

import { ContractStatus, ContractType } from "../src/generated/prisma/enums";
import { prisma } from "../src/server/db/client";

/**
 * One-off filler data for the main demo org ("senecial-dev", the org
 * `owner@example.com` from prisma/seed.ts belongs to) so the contracts
 * list / analytics screens don't look sparse during a live demo. Distinct
 * from scripts/seed-analytics-performance-data.ts, which seeds a SEPARATE
 * "분석 성능 테스트 조직" for load-testing and is never visible from the
 * owner@example.com account. Safe to re-run - contractNumber is checked
 * before insert, so re-running just tops up to the target count instead of
 * duplicating.
 */

const ORG_SLUG = "senecial-dev";
const OWNER_EMAIL = "owner@example.com";
const TARGET_COUNT = Number(process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] ?? 200);

const EXTRA_COUNTERPARTIES = [
  "델타전자 주식회사", "제타물류", "에타바이오", "세타건설", "요타파트너스",
  "카파소프트", "람다테크놀로지", "뮤디자인", "누클라우드", "크사이헬스케어",
  "오미크론금융", "파이컨설팅", "로시스템", "시그마리테일", "타우모빌리티",
  "입실론에너지", "피코미디어", "카이물산", "프사이엔터", "오메가상사",
] as const;

const INDUSTRY_WORDS = [
  "소프트웨어", "물류", "제조", "컨설팅", "마케팅", "금융", "헬스케어",
  "에너지", "리테일", "미디어", "건설", "교육", "모빌리티", "엔터테인먼트",
] as const;

const TYPE_LABEL: Record<ContractType, string> = {
  NDA: "비밀유지계약",
  SERVICE: "용역계약",
  SUPPLY: "공급계약",
  EMPLOYMENT: "근로계약",
  LICENSE: "라이선스계약",
  INVESTMENT: "투자계약",
  SHAREHOLDER: "주주간계약",
  LEASE: "임대차계약",
  PARTNERSHIP: "파트너십계약",
  OTHER: "기타계약",
};

const CONTRACT_TYPES = Object.values(ContractType);
// Weighted so the demo org looks like a normal, mostly-active business.
const STATUS_WEIGHTS: Array<[ContractStatus, number]> = [
  [ContractStatus.ACTIVE, 55],
  [ContractStatus.DRAFT, 15],
  [ContractStatus.TERMINATED, 15],
  [ContractStatus.ARCHIVED, 15],
];
const CURRENCIES = ["KRW", "KRW", "KRW", "USD"];

function pickWeighted<T>(weighted: Array<[T, number]>): T {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted[0]![0];
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run demo filler seed with NODE_ENV=production.");
  }

  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`Organization "${ORG_SLUG}" not found - run "npm run db:seed" first.`);
  }

  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!owner) {
    throw new Error(`User "${OWNER_EMAIL}" not found - run "npm run db:seed" first.`);
  }

  const counterpartyIds: string[] = (
    await prisma.counterparty.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
    })
  ).map((c) => c.id);

  for (const name of EXTRA_COUNTERPARTIES) {
    const existing = await prisma.counterparty.findFirst({
      where: { organizationId: organization.id, name },
      select: { id: true },
    });
    if (existing) {
      counterpartyIds.push(existing.id);
      continue;
    }
    const created = await prisma.counterparty.create({
      data: {
        organizationId: organization.id,
        name,
        businessNumber: `${100 + Math.floor(Math.random() * 800)}-${10 + Math.floor(Math.random() * 89)}-${10000 + Math.floor(Math.random() * 89999)}`,
        representativeName: `대표${Math.floor(Math.random() * 900) + 100}`,
        contactName: `담당${Math.floor(Math.random() * 900) + 100}`,
        contactEmail: `contact@${name.replace(/\s/g, "").toLowerCase()}.example.com`,
        contactPhone: `02-${1000 + Math.floor(Math.random() * 8999)}-${1000 + Math.floor(Math.random() * 8999)}`,
      },
      select: { id: true },
    });
    counterpartyIds.push(created.id);
  }

  const existingCount = await prisma.contract.count({
    where: { organizationId: organization.id, contractNumber: { startsWith: "DEMO-" } },
  });

  const toCreate = Math.max(0, TARGET_COUNT - existingCount);
  if (toCreate === 0) {
    console.log(`이미 DEMO- 계약이 ${existingCount}건 있어 목표(${TARGET_COUNT}건)를 충족합니다. 추가 생성 없음.`);
    return;
  }

  let created = 0;
  for (let i = existingCount + 1; i <= existingCount + toCreate; i += 1) {
    const contractNumber = `DEMO-${String(i).padStart(4, "0")}`;
    const contractType = pick(CONTRACT_TYPES);
    const status = pickWeighted(STATUS_WEIGHTS);
    const hasCounterparty = Math.random() > 0.15;
    const counterpartyId = hasCounterparty ? pick(counterpartyIds) : null;
    const startOffsetDays = -Math.floor(Math.random() * 500);
    const endOffsetDays = startOffsetDays + 90 + Math.floor(Math.random() * 700);
    const autoRenewal = Math.random() > 0.6;
    const amount = Math.random() > 0.1 ? String(Math.floor(Math.random() * 490_000_000) + 1_000_000) : null;

    await prisma.contract.create({
      data: {
        organizationId: organization.id,
        createdById: owner.id,
        counterpartyId,
        title: `${pick(INDUSTRY_WORDS)} ${TYPE_LABEL[contractType]} 제${i}호`,
        contractNumber,
        contractType,
        status,
        startDate: daysFromNow(startOffsetDays),
        endDate: status === ContractStatus.DRAFT ? null : daysFromNow(endOffsetDays),
        autoRenewal,
        amount,
        currency: amount ? pick(CURRENCIES) : null,
      },
    });
    created += 1;
    if (created % 50 === 0) {
      console.log(`  ...${created}/${toCreate}건 생성`);
    }
  }

  const totalNow = await prisma.contract.count({ where: { organizationId: organization.id } });
  console.log(`완료: DEMO- 계약 ${created}건 신규 생성 (기존 ${existingCount}건 + 신규 = ${existingCount + created}건). 조직 전체 계약 수: ${totalNow}건.`);
}

main()
  .catch((error: unknown) => {
    console.error("데모 계약 생성 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
