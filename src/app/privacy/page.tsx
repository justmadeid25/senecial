import type { Metadata } from "next";

import { PolicyPageShell, PolicySection } from "@/features/legal/components/policy-page-shell";

export const metadata: Metadata = { title: "개인정보처리방침 | Senecial" };

const EFFECTIVE_DATE = "2026년 9월 3일";

export default function PrivacyPolicyPage() {
  return (
    <PolicyPageShell title="개인정보처리방침" updatedLabel={`시행일: ${EFFECTIVE_DATE} (비공개 베타 버전)`}>
      <p className="text-muted-foreground">
        이 문서는 Senecial의 비공개 베타(Closed Beta) 서비스가 실제로 어떤 정보를 어떻게 처리하는지를
        설명합니다. 아래 내용은 실제 구현을 기준으로 작성되었으며, 아직 구현되지 않은 기능(예: 계정 자가
        삭제)은 &ldquo;현재 제공되지 않음&rdquo;으로 명시합니다.
      </p>

      <PolicySection title="1. 처리하는 정보">
        <p>
          <strong>계정·조직 정보</strong> — 이름, 이메일 주소, 비밀번호(해시 값만 저장되며 원문은 저장되지
          않습니다), 소속 조직명, 조직 내 역할(소유자/구성원).
        </p>
        <p>
          <strong>초대 정보</strong> — 조직에 구성원을 초대할 때 입력한 초대 대상 이메일 주소, 초대한 사람,
          부여된 역할. 초대·이메일 인증·비밀번호 재설정에 사용되는 토큰은 원문이 아니라 해시 값으로만
          저장됩니다.
        </p>
        <p>
          <strong>계약 문서 데이터</strong> — 업로드한 원본 파일, 파일에서 추출한 전체 텍스트, 조항 단위로
          분해된 내용, AI 검색을 위해 문서를 잘게 나눈 조각(청크), 그리고 이 텍스트들로부터 생성된 임베딩
          벡터(검색용 수치 데이터).
        </p>
        <p>
          <strong>AI 대화 데이터</strong> — 사용자가 입력한 질문 전문, AI가 생성한 답변 전문, 답변의 근거로
          표시된 계약서 인용 구절(구절당 최대 500자).
        </p>
        <p>
          <strong>이용 기록</strong> — 주요 활동에 대한 감사 로그(누가, 언제, 무엇을 했는지의 항목 정보만
          기록되며 계약 내용 자체는 기록되지 않습니다), AI 사용량 통계(토큰 수·예상 비용·응답 속도 — 질문·답변
          내용이나 실제 API 요청/응답 원문은 포함되지 않습니다).
        </p>
        <p>
          <strong>문의·피드백</strong> — 이용자가 직접 작성해 제출한 문의/피드백 내용.
        </p>
      </PolicySection>

      <PolicySection title="2. 처리 목적">
        <ul>
          <li>회원가입, 로그인, 조직 구성원 관리 등 서비스 제공을 위한 계정 인증 및 권한 관리</li>
          <li>업로드한 계약서의 조항 분해·검색·AI 질의응답 기능 제공</li>
          <li>서비스 오류 대응 및 악용 방지를 위한 활동 기록</li>
          <li>이용자 문의 응대</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. 계약서 처리 과정">
        <p>
          업로드된 계약서는 다음 순서로 처리됩니다: (1) 원본 파일 저장 → (2) 텍스트 추출 → (3) 조항 단위 분해
          → (4) 검색을 위한 임베딩 생성. 추출·조항 분해는 이 서비스 자체 로직으로 수행되며, 이 단계에서
          외부 AI 사업자에게 파일이나 텍스트가 전송되지 않습니다. 임베딩 생성과 AI 질의응답 단계에서만 아래
          4번 항목의 방식으로 OpenAI에 일부 텍스트가 전송됩니다.
        </p>
      </PolicySection>

      <PolicySection title="4. AI 처리 및 외부 전송 (OpenAI)">
        <p>
          질문에 답하거나 검색용 임베딩을 생성할 때, 이 서비스는 OpenAI의 API를 사용합니다. 실제로 전송되는
          내용은 다음과 같이 제한됩니다.
        </p>
        <ul>
          <li>
            <strong>임베딩 생성 시</strong> — 이미 추출·정규화된 조항/문단 텍스트만 전송됩니다. 원본 파일
            자체가 전송되지 않습니다.
          </li>
          <li>
            <strong>질문에 답할 때</strong> — 사용자의 질문 전문과, 검색을 통해 선별된 근거 구절(구절당 최대
            500자, 질문 성격에 따라 보통 5개 내외)만 전송됩니다. 계약서 원문 전체나 조직의 다른 계약 데이터는
            전송되지 않습니다. 직전 대화 맥락도 함께 전송될 수 있으나, 최근 몇 개 turn으로 제한되고 각 메시지는
            일정 길이로 잘려 전송됩니다.
          </li>
          <li>
            <strong>전송되지 않는 정보</strong> — 조직명, 이용자 이름·이메일 등 개인을 특정할 수 있는 메타데이터는
            AI 요청에 포함되지 않습니다.
          </li>
          <li>
            <strong>store:false 옵션</strong> — 이 서비스는 OpenAI API 요청마다 &ldquo;응답을 서버에 저장하지
            않음(store:false)&rdquo; 옵션을 명시적으로 전송합니다.
          </li>
        </ul>
        <p>
          다만 정확히 알려드려야 할 한계가 있습니다: <strong>store:false는 OpenAI와 별도로 체결하는 &ldquo;Zero
          Data Retention&rdquo; 계약과 다릅니다.</strong> 이 서비스는 OpenAI와 별도의 Zero Data Retention
          계약을 맺고 있지 않습니다. store:false를 전송하더라도 OpenAI의 표준 약관에 따른 단기 안전·남용
          모니터링 목적의 보존은 적용될 수 있으며, 이는 OpenAI 자체의 정책 범위로 이 서비스가 통제할 수 있는
          영역이 아닙니다. 이 서비스가 보장하는 것은 &ldquo;요청마다 store:false를 전송한다&rdquo;는 사실이며,
          OpenAI 측 보존 정책의 전체 내용까지 보장하는 것은 아닙니다.
        </p>
      </PolicySection>

      <PolicySection title="5. 제3자 인프라 및 처리자">
        <p>서비스 운영을 위해 아래 인프라/처리자를 이용합니다. 계약서 원문이나 개인정보를 직접 취급하지 않는 항목도 포함되어 있습니다.</p>
        <ul>
          <li>
            <strong>OpenAI</strong> — AI 질의응답 및 임베딩 생성. 전송 범위는 4번 항목 참고.
          </li>
          <li>
            <strong>클라우드 객체 스토리지 (S3 호환, 예: Cloudflare R2)</strong> — 업로드한 원본 계약서 파일이
            저장되는 곳입니다.
          </li>
          <li>
            <strong>PostgreSQL 데이터베이스 (예: Neon)</strong> — 계정·조직·계약 조항·임베딩·AI 대화 기록 등
            대부분의 구조화된 데이터가 저장되는 곳입니다.
          </li>
          <li>
            <strong>Redis (예: Upstash)</strong> — 요청 속도 제한, 일부 AI 응답 캐시 등 일시적인 운영 데이터에
            사용됩니다.
          </li>
          <li>
            <strong>Postmark</strong> — 초대, 이메일 인증, 비밀번호 재설정, 비밀번호 변경 알림 등 이메일 발송에
            사용됩니다. 수신자 이메일 주소와 이메일 본문(링크 포함)이 전달되며, 계약서 내용은 포함되지 않습니다.
          </li>
          <li>
            <strong>Railway / Vercel</strong> — 애플리케이션 서버와 백그라운드 작업 처리 인프라를 운영하는
            호스팅 사업자입니다.
          </li>
          <li>
            <strong>악성코드 스캐너</strong> — 업로드된 파일을 검사하기 위한 자체 호스팅 서비스로, 외부 상용
            API가 아니라 이 서비스 인프라 내부(Railway)에서 직접 운영됩니다. 업로드된 파일은 검사를 위해 이
            내부 서비스로 전송되며, 그 밖의 제3자에게는 전달되지 않습니다.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="6. 보관 및 삭제">
        <p>비공개 베타 단계에서 실제로 구현된 삭제 동작은 다음과 같습니다. 구현되지 않은 기능은 있는 그대로 명시합니다.</p>
        <ul>
          <li>
            <strong>계약서 삭제</strong> — 계약서를 삭제하면 즉시 목록/검색에서 보이지 않게 됩니다(소프트
            삭제). 파일과 관련 데이터의 완전 삭제는 일정 보관 기간이 지난 뒤 운영자가 수행하는 별도 절차를
            통해 이루어지며, 현재 이 절차는 자동으로 실행되지 않고 운영자가 수동으로 실행해야 합니다.
          </li>
          <li>
            <strong>개별 파일 삭제</strong> — 파일 삭제를 요청하면 저장소에서도 즉시 삭제를 시도합니다. 즉시
            삭제가 실패하는 드문 경우에도 수 분 내 자동으로 재시도됩니다.
          </li>
          <li>
            <strong>AI 대화 및 인용 근거</strong> — <strong>현재 이용자가 직접 대화 기록을 삭제할 수 있는 기능은
            제공되지 않습니다.</strong> 또한 계약서가 완전히 삭제된 이후에도, 그 계약서를 근거로 했던 과거
            AI 대화와 인용 구절(최대 500자)은 &ldquo;어떤 근거로 어떤 답변을 했는지&rdquo;에 대한 기록으로서
            계속 보관됩니다.
          </li>
          <li>
            <strong>계정 및 조직 삭제</strong> — <strong>현재 이용자가 직접 계정이나 조직을 삭제할 수 있는
            기능은 제공되지 않습니다.</strong> 삭제를 원하시면 아래 문의처로 연락해 주시면 운영자가 처리합니다.
          </li>
          <li>
            <strong>활동 기록(감사 로그)</strong> — 오류 대응과 보안 목적으로 보관되며, 현재 구현에는 자동
            만료 없이 보관됩니다. 이 정책은 베타 종료 전 재검토될 수 있습니다.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="7. 보안 조치">
        <ul>
          <li>모든 데이터는 조직 단위로 격리되어 저장·조회되며, 다른 조직의 데이터는 어떤 API로도 조회되지 않도록 서버 측에서 매 요청마다 소속을 재확인합니다.</li>
          <li>조직 내 권한은 역할(소유자/구성원)에 따라 구분되어 관리됩니다.</li>
          <li>업로드되는 모든 파일은 저장 전에 악성코드 검사를 거치며, 검사가 실패하거나 응답하지 않으면 업로드 자체가 차단됩니다(안전 우선 원칙).</li>
          <li>비밀번호는 원문이 아닌 해시 값으로만 저장되며, 인증·초대 토큰도 마찬가지입니다.</li>
          <li>서비스와의 통신은 HTTPS로 암호화됩니다.</li>
        </ul>
        <p className="text-xs">
          이 서비스는 ISO 27001, SOC 2, ISMS, GDPR 등 특정 인증이나 법적 준수를 표방하지 않습니다. 위 항목은
          현재 구현된 기술적 조치를 설명한 것이며, 별도의 인증 취득이나 법적 준수 선언이 아닙니다.
        </p>
      </PolicySection>

      <PolicySection title="8. 문의처">
        <p>
          개인정보 처리에 대한 문의, 열람·정정·삭제 등 권리 행사 요청, 계정·조직 삭제 요청은 아래 이메일로
          보내주십시오.
        </p>
        <p>
          문의: <a href="mailto:admin@senecial.co.kr" className="underline underline-offset-2 hover:text-foreground">admin@senecial.co.kr</a>
        </p>
      </PolicySection>

      <PolicySection title="9. 시행일 및 개정">
        <p>
          이 개인정보처리방침은 {EFFECTIVE_DATE}부터 적용됩니다. 비공개 베타 기간 중 서비스 구현이 변경되면 이
          문서도 함께 갱신되며, 실제 동작과 이 문서가 다르다고 판단되면 8번 문의처로 알려주시기 바랍니다.
        </p>
      </PolicySection>
    </PolicyPageShell>
  );
}
