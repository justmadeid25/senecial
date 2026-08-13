"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 4000;
/** Hard cap so a genuinely stuck backend (§Part 4 - "no runaway requests") stops auto-polling instead of refreshing forever; the manual "다시 확인" button remains available. */
const MAX_POLL_DURATION_MS = 3 * 60 * 1000;

/** One polling session's lifetime - mounted fresh (via `key`) every time isPolling transitions false -> true, so its own state never needs resetting from an effect. */
function PollingSession() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }

    const intervalId = window.setInterval(() => {
      // §Phase 15.1R - a `document.hidden` early-return here was tried and
      // removed: it caused a real, silent failure found via a live manual
      // browser walkthrough (not caught by any automated test, since
      // Playwright/CDP-controlled tabs consistently report
      // `document.hidden === true` even while being actively driven, so
      // the interval never called router.refresh() but the banner still
      // claimed "자동으로 갱신됩니다"). Polling unconditionally is still
      // bounded (§Part 4 - "no runaway requests") by MAX_POLL_DURATION_MS
      // below - at most ~45 requests over 3 minutes, whether or not the
      // tab is foregrounded.
      const elapsed = Date.now() - (startedAtRef.current ?? Date.now());
      if (elapsed >= MAX_POLL_DURATION_MS) {
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [router]);

  if (timedOut) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>예상보다 오래 걸리고 있습니다.</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => {
            startedAtRef.current = Date.now();
            setTimedOut(false);
            router.refresh();
          }}
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          다시 확인
        </Button>
      </div>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <RefreshCw className="size-3 motion-safe:animate-spin" aria-hidden="true" />
      자동으로 갱신됩니다
    </span>
  );
}

/**
 * §Phase 15.1 §Part 4 - smallest reliable live-refresh mechanism: reuses
 * Next.js's existing `router.refresh()` (already used elsewhere in this
 * codebase, e.g. start-segmentation-button.tsx) rather than introducing
 * WebSockets/SSE. The server recomputes `isPolling` from real job state on
 * every refresh and passes it back down - this component does not decide
 * when to stop, it only reacts to the prop flipping to false, so it is
 * impossible for this to poll past a terminal state.
 *
 * `sessionId` bumps only on a false -> true transition (React's own
 * "adjusting state during rendering" pattern - see React docs - rather
 * than an effect that calls setState) so PollingSession below remounts
 * fresh (via `key`) at the start of every new polling session instead of
 * needing to reset its own state from inside an effect.
 */
export function ProcessingStatusPoller({ isPolling }: { isPolling: boolean }) {
  const [sessionId, setSessionId] = useState(0);
  const [previousIsPolling, setPreviousIsPolling] = useState(isPolling);

  if (isPolling !== previousIsPolling) {
    setPreviousIsPolling(isPolling);
    if (isPolling) {
      setSessionId((id) => id + 1);
    }
  }

  if (!isPolling) {
    return null;
  }

  return <PollingSession key={sessionId} />;
}
