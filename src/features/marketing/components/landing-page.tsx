import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ContractIntelligenceVisual } from "@/features/marketing/components/contract-intelligence-visual";

const SCROLL_STORY = [
  {
    step: "01",
    title: "업로드",
    body: "PDF, DOCX, HWP 계약서를 업로드하면 원문 전체가 분석 대상이 됩니다.",
  },
  {
    step: "02",
    title: "구조화",
    body: "조항 단위 분석과 원문 근거가 함께 정리되어, 조항으로 나뉘지 않은 내용도 놓치지 않습니다.",
  },
  {
    step: "03",
    title: "질문",
    body: "“해지 조건이 뭐야?”처럼 자연어로 질문하면, 실제 계약 내용을 찾아 답합니다.",
  },
  {
    step: "04",
    title: "확인",
    body: "답변 옆의 근거 표시를 클릭하면 실제 계약 문장으로 바로 연결됩니다. 추측이 아니라 확인입니다.",
  },
  {
    step: "05",
    title: "통제",
    body: "조직별로 데이터가 완전히 분리되고, 모든 활동은 감사 로그로 남습니다.",
  },
] as const;

const TRUST_POINTS = [
  { title: "조직별 데이터 격리", body: "다른 조직의 계약 데이터는 어떤 경로로도 조회되지 않습니다." },
  { title: "근거 기반 답변", body: "모든 AI 답변은 실제 계약 원문의 근거 문장과 함께 제공됩니다." },
  { title: "감사 로그", body: "주요 활동은 감사 로그로 기록되어 추적할 수 있습니다." },
  { title: "역할 기반 접근 제어", body: "조직 내 역할에 따라 접근 권한이 관리됩니다." },
] as const;

export function LandingPage() {
  return (
    <div className="relative flex min-h-full flex-col overflow-x-hidden bg-background">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] overflow-hidden">
        <div className="landing-ambient-field absolute left-1/2 top-[-220px] h-[620px] w-[900px] rounded-full opacity-[0.16] blur-3xl" />
      </div>

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-sm font-semibold tracking-tight text-foreground">Senecial</span>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" nativeButton={false} render={<Link href="/login" />}>
            로그인
          </Button>
          <Button nativeButton={false} render={<Link href="/signup" />}>
            무료로 시작하기
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-20">
        <div className="max-w-xl">
          <p className="mb-4 inline-flex items-center rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            계약 인텔리전스 플랫폼
          </p>
          <h1 className="text-hero text-foreground">
            계약서를 읽는 AI가 아니라,
            <br />
            <span className="text-flow-gradient">계약을 이해하는 AI</span>
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
            계약서 원문과 조항을 함께 분석하고, 모든 답변의 근거를 실제 계약서에서 확인하세요.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" className="h-11 px-6 text-base" nativeButton={false} render={<Link href="/signup" />}>
              무료로 시작하기
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 text-base"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              로그인
            </Button>
          </div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <ContractIntelligenceVisual />
        </div>
      </section>

      {/* Scroll story */}
      <section className="border-t border-border bg-secondary/40 py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <h2 className="max-w-lg text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            계약서 한 장이 답변의 근거가 되기까지
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            {SCROLL_STORY.map((item) => (
              <div key={item.step} className="flex flex-col gap-3">
                <span className="text-tabular text-xs font-semibold text-primary">{item.step}</span>
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="border-t border-border py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            기업의 계약서를 다루는 기준
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_POINTS.map((point) => (
              <div key={point.title} className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} Senecial</span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              로그인
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              회원가입
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
