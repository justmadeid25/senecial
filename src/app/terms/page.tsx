import type { Metadata } from "next";

import { PolicyPageShell, PolicySection } from "@/features/legal/components/policy-page-shell";

export const metadata: Metadata = { title: "이용약관 | Senecial" };

const EFFECTIVE_DATE = "2026년 9월 3일";

export default function TermsOfServicePage() {
  return (
    <PolicyPageShell title="이용약관" updatedLabel={`시행일: ${EFFECTIVE_DATE} (비공개 베타 버전)`}>
      <p className="text-muted-foreground">
        이 약관은 Senecial의 비공개 베타(Closed Beta) 서비스 이용에 적용됩니다. 베타 서비스의 특성상 아래 내용은
        정식 출시 전까지 변경될 수 있습니다.
      </p>

      <PolicySection title="1. 서비스의 성격 (비공개 베타)">
        <p>
          Senecial은 현재 소수의 초대된 이용자만을 대상으로 하는 비공개 베타 서비스입니다. 기능이 예고 없이
          변경·중단될 수 있고, 예상치 못한 오류가 발생할 수 있습니다. 정식 서비스 수준의 가용성이나 안정성을
          보장하지 않습니다.
        </p>
      </PolicySection>

      <PolicySection title="2. 계정 책임">
        <ul>
          <li>이용자는 가입 시 입력한 정보를 정확하게 유지해야 합니다.</li>
          <li>계정 접근 정보(비밀번호 등)를 안전하게 관리할 책임은 이용자에게 있으며, 본인 계정에서 발생한 활동에 대한 책임을 집니다.</li>
          <li>계정 도용이나 비정상적인 접근이 의심되면 즉시 아래 11번 문의처로 알려주시기 바랍니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. 허용된 사용 범위">
        <p>
          이 서비스는 이용자가 소속된 조직의 업무 목적(계약서 검토·관리)으로만 사용할 수 있습니다. 서비스와
          그 구성 요소(소프트웨어, AI 프롬프트 로직, UI/UX)를 역설계, 재판매, 재배포하거나 이 서비스와
          경쟁하는 제품을 만드는 데 사용하는 것은 허용되지 않습니다.
        </p>
      </PolicySection>

      <PolicySection title="4. 업로드 콘텐츠에 대한 책임">
        <ul>
          <li>이용자는 본인이 업로드·처리할 적법한 권한을 가진 문서만 업로드해야 합니다.</li>
          <li>제3자의 권리(저작권, 영업비밀, 개인정보 등)를 침해하는 문서를 업로드해서는 안 됩니다.</li>
          <li>업로드한 콘텐츠의 적법성과 정확성에 대한 책임은 업로드한 이용자 및 소속 조직에 있습니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="5. 서비스 가용성 및 변경">
        <p>
          베타 기간 중 서비스는 사전 고지 없이 기능이 추가·변경·제거될 수 있으며, 점검이나 예기치 못한 장애로
          일시 중단될 수 있습니다. 데이터 보존을 위한 노력을 기울이지만, 베타 서비스 특성상 완전한 데이터
          보존을 보장하지 않습니다.
        </p>
      </PolicySection>

      <PolicySection title="6. AI 기능의 한계">
        <ul>
          <li>AI 답변은 업로드된 계약서를 검색해 근거와 함께 제공하는 참고 정보이며, 오류나 누락이 있을 수 있습니다.</li>
          <li>AI는 계약 내용을 임의로 수정하지 않으며, 계약의 위험도를 단정적으로 판단하지 않습니다.</li>
          <li>AI 답변은 변호사 등 전문가의 법률 자문을 대체하지 않습니다. 중요한 법적·계약적 판단을 내리기 전에는 반드시 표시된 근거 원문을 직접 확인하고, 필요한 경우 전문가와 상담하시기 바랍니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="7. 지적재산권">
        <ul>
          <li>이용자가 업로드한 계약서 및 그 안의 콘텐츠에 대한 권리는 이용자(또는 정당한 권리자)에게 있습니다.</li>
          <li>Senecial 서비스 자체(소프트웨어, 디자인, AI 처리 로직, 상표 등)에 대한 권리는 Senecial에 있습니다.</li>
          <li>서비스 이용 과정에서 생성되는 AI 답변·인용·조항 분류 등 산출물은 이용자가 본인 업무 목적으로 사용할 수 있으나, 이는 업로드한 원본 문서의 권리관계에 영향을 주지 않습니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="8. 금지 행위">
        <ul>
          <li>서비스의 정상적인 운영을 방해하는 행위(과도한 자동화 요청, 취약점 무단 공격 등)</li>
          <li>타인의 계정 또는 조직 데이터에 부정하게 접근하려는 시도</li>
          <li>악성코드가 포함된 파일을 의도적으로 업로드하는 행위</li>
          <li>법령을 위반하거나 제3자의 권리를 침해하는 목적의 이용</li>
        </ul>
      </PolicySection>

      <PolicySection title="9. 계정 제한 및 종료">
        <p>
          이용자가 본 약관을 위반하거나 서비스 운영에 심각한 지장을 초래하는 경우, 운영자는 사전 통지 후(긴급한
          경우 사후 통지) 계정 이용을 제한하거나 종료할 수 있습니다. 베타 종료 시에는 사전에 안내드립니다.
        </p>
      </PolicySection>

      <PolicySection title="10. 책임의 제한">
        <p>
          Senecial은 비공개 베타 서비스로 무상 또는 그에 준하는 조건으로 제공되며, 관련 법령이 허용하는 최대
          범위에서 서비스 이용으로 발생하는 간접적·부수적 손해에 대한 책임을 지지 않습니다. 서비스는
          &ldquo;있는 그대로(as-is)&rdquo; 제공되며, 특정 목적에의 적합성을 포함한 명시적·묵시적 보증을 하지
          않습니다. 이 조항은 베타 서비스 단계에 적용되는 내용이며, 정식 서비스 전환 시 별도로 개정될 수
          있습니다.
        </p>
      </PolicySection>

      <PolicySection title="11. 운영 주체 및 문의처">
        <p>
          Senecial은 현재 개인이 운영하는 Closed Beta 서비스이며, 별도로 등록된 법인이나 사업자가 아닙니다.
          이용약관·개인정보처리방침 관련 문의나 서비스 이용 중 발생하는 사항은 아래 이메일로 연락해 주십시오.
        </p>
        <p>
          문의: <a href="mailto:admin@senecial.co.kr" className="underline underline-offset-2 hover:text-foreground">admin@senecial.co.kr</a>
        </p>
      </PolicySection>

      <PolicySection title="12. 시행일 및 개정">
        <p>
          이 약관은 {EFFECTIVE_DATE}부터 적용됩니다. 베타 기간 중 서비스 변경에 따라 이 약관도 갱신될 수 있으며,
          중요한 변경 시에는 서비스 내 안내를 통해 고지합니다.
        </p>
      </PolicySection>
    </PolicyPageShell>
  );
}
