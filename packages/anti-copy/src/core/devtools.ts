import type { Feature, ResolvedOptions } from "./types";

/**
 * Elapsed time around the probe above which the `debugger` statement is
 * treated as having paused execution — a debugger is attached and still
 * honors breakpoints.
 */
const PAUSE_THRESHOLD_MS = 100;
/** Cadence of the guard loop that keeps re-pausing the page while DevTools is open. */
const GUARD_INTERVAL_MS = 20;
/**
 * Guard ticks tolerated when DevTools stays open per the size heuristic
 * while the previously confirmed probe stall no longer pauses — the stall
 * was neutralized in place ("deactivate breakpoints", "never pause here")
 * — before the page is evicted (~500ms at the guard cadence).
 */
const BYPASS_MAX_TICKS = 25;

/**
 * Builds the anonymous debugger probe. The Function constructor form is
 * what shows up in DevTools as `(function anonymous() { debugger })` and
 * survives naive static removal of `debugger` statements; environments
 * whose CSP blocks indirect eval fall back to a literal statement.
 */
function createProbe(): () => void {
  try {
    return Function("debugger") as () => void;
  } catch {
    return () => {
      debugger;
    };
  }
}

/**
 * DevTools protection in two layers:
 *
 * 1. Detection — the window outer/inner size delta heuristic for docked
 *    DevTools, plus the elapsed time around a `debugger` probe, which only
 *    takes measurable time while a debugger is attached. The probe also
 *    catches undocked DevTools windows the size heuristic cannot see.
 *
 * 2. Countermeasures — once the probe confirms a pause, a tight guard loop
 *    keeps re-running it so execution pauses over and over, stalling the
 *    page until DevTools is closed. If DevTools stays open (per the size
 *    heuristic) while the probe stops pausing, the stall was neutralized
 *    in place ("deactivate breakpoints", "never pause here") and the page
 *    is redirected to a blank page. Countermeasures require the probe to
 *    have paused: size-only detections merely report via `onViolation`.
 *
 * Known limitations, by design:
 * - Browser zoom or unusual window chrome can trip the size heuristic;
 *   such false positives only fire `onViolation` reports — they can never
 *   freeze or evict the page.
 * - A debugger stall neutralized before it ever pauses (e.g. a userscript
 *   hooking `Function` at load) is detected by size only and therefore
 *   reported but never evicted.
 * - Disabled on coarse-pointer (touch) devices and very narrow windows.
 * - Undocked DevTools with breakpoints deactivated are indistinguishable
 *   from closed DevTools.
 *
 * This is a deterrent, not a security boundary.
 */
export function createDevtoolsFeature(options: ResolvedOptions): Feature {
  const config = options.devtools;
  const view = options.target.defaultView;
  if (config === false || !view) {
    return {
      attach() {
        /** noop */
      },
      detach() {
        /** noop */
      },
    };
  }

  const probe = config.freeze ? createProbe() : null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let guardTimer: ReturnType<typeof setInterval> | null = null;
  let lastOpened = false;
  let bypassTicks = 0;
  let redirected = false;

  const clock = (): number => {
    const perf = view.performance;
    return perf && typeof perf.now === "function" ? perf.now() : Date.now();
  };

  const sizeOpen = () => {
    if (
      view.outerWidth < 800 ||
      view.matchMedia?.("(pointer: coarse)").matches
    ) {
      return false;
    }
    return (
      view.outerWidth - view.innerWidth > config.threshold ||
      view.outerHeight - view.innerHeight > config.threshold
    );
  };

  /**
   * Runs the debugger probe and returns the elapsed milliseconds. Above
   * {@link PAUSE_THRESHOLD_MS} the statement paused: a debugger is
   * attached and the stall is working.
   */
  const runProbe = (): number => {
    const start = clock();
    probe?.();
    return clock() - start;
  };

  const startPoll = () => {
    if (pollTimer === null && guardTimer === null) {
      pollTimer = setInterval(pollTick, config.intervalMs);
    }
  };

  const stopLoops = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (guardTimer !== null) {
      clearInterval(guardTimer);
      guardTimer = null;
    }
  };

  const redirectTo = (url: string) => {
    stopLoops();
    redirected = true;
    try {
      // Evict the top document — navigating only an embedded iframe would
      // leave the protected page one back-button away.
      (view.top ?? view).location.href = url;
    } catch {
      // Cross-origin top window: its location is not accessible.
      view.location.href = url;
    }
  };

  /**
   * Tight loop entered once DevTools is detected: every tick re-runs the
   * probe, re-pausing execution while DevTools is open.
   */
  const guardTick = () => {
    if (redirected) return;
    const paused = runProbe() > PAUSE_THRESHOLD_MS;
    if (!paused && !sizeOpen()) {
      // DevTools closed — drop back to slow polling.
      stopLoops();
      lastOpened = false;
      startPoll();
      return;
    }
    if (!lastOpened) {
      lastOpened = true;
      options.onViolation?.({ type: "devtools" });
    }
    if (paused) {
      // The stall is working; keep re-pausing.
      bypassTicks = 0;
      return;
    }
    // DevTools is open yet the probe never pauses: the stall has been
    // neutralized. Tolerate it briefly, then evict the page.
    bypassTicks += 1;
    if (config.redirectUrl !== false && bypassTicks >= BYPASS_MAX_TICKS) {
      redirectTo(config.redirectUrl);
    }
  };

  const pollTick = () => {
    if (redirected || guardTimer !== null) return;
    const paused = runProbe() > PAUSE_THRESHOLD_MS;
    if (!paused && !sizeOpen()) {
      lastOpened = false;
      return;
    }
    if (!lastOpened) {
      lastOpened = true;
      options.onViolation?.({ type: "devtools" });
    }
    if (paused) {
      // Escalate to the guard loop so the probe keeps re-pausing the page.
      // Escalation requires probe-confirmed evidence: a size-only detection
      // (browser zoom, unusual window chrome) stays report-only and must
      // never lead to the freeze/redirect countermeasures.
      stopLoops();
      bypassTicks = 0;
      guardTimer = setInterval(guardTick, GUARD_INTERVAL_MS);
    }
  };

  return {
    attach() {
      if (pollTimer !== null || guardTimer !== null) return;
      // Docked DevTools change the viewport on open/close — react at once.
      view.addEventListener("resize", pollTick);
      startPoll();
    },
    detach() {
      view.removeEventListener("resize", pollTick);
      stopLoops();
      lastOpened = false;
      bypassTicks = 0;
      redirected = false;
    },
  };
}
