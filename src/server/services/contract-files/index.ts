import type { FileMalwareScanner } from "@/domain/contract-files/malware-scanner";
import { resolveMalwareScannerConfig } from "@/lib/config/malware-scanner";

import { ClamAvHttpFileMalwareScanner } from "./clamav-http-file-malware-scanner";
import { NoopFileMalwareScanner } from "./noop-file-malware-scanner";

let cachedScanner: FileMalwareScanner | undefined;

/**
 * Returns the configured malware scanner. `FILE_MALWARE_SCANNER=noop` (the
 * default) provides no real protection - see NoopFileMalwareScanner's
 * warning - and is refused in production unless explicitly overridden,
 * mirroring getInvitationMailer()'s production guard for the same reason:
 * a silent no-op safety feature should never be able to reach production
 * by simply forgetting to configure something.
 */
export function getFileMalwareScanner(): FileMalwareScanner {
  if (cachedScanner) {
    return cachedScanner;
  }

  const driver = process.env.FILE_MALWARE_SCANNER ?? "noop";

  switch (driver) {
    case "noop": {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_NOOP_MALWARE_SCANNER !== "true"
      ) {
        throw new Error(
          "FILE_MALWARE_SCANNER=noop은 운영 환경에서 사용할 수 없습니다. 실제 악성코드 스캐너를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_NOOP_MALWARE_SCANNER=true를 설정하십시오."
        );
      }
      cachedScanner = new NoopFileMalwareScanner();
      return cachedScanner;
    }
    case "clamav-http": {
      cachedScanner = new ClamAvHttpFileMalwareScanner(resolveMalwareScannerConfig());
      return cachedScanner;
    }
    default:
      throw new Error(`지원하지 않는 FILE_MALWARE_SCANNER 입니다: ${driver}`);
  }
}
