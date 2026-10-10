import type { Feature, ResolvedOptions } from "./types";

const PAUSE_THRESHOLD_MS = 100;
const GUARD_INTERVAL_MS = 20;
const BYPASS_MAX_TICKS = 25;

function createProbe(): () => void {
  try {
    return Function("debugger") as () => void;
  } catch {
    return () => {
      debugger;
    };
  }
}

export function createDevtoolsFeature(options: ResolvedOptions): Feature {
  const config = options.devtools;
  const view = options.target.defaultView;
  if (config === false || !view) {
    return {
      attach() {},
      detach() {},
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
      (view.top ?? view).location.href = url;
    } catch {
      view.location.href = url;
    }
  };

  const guardTick = () => {
    if (redirected) return;
    const paused = runProbe() > PAUSE_THRESHOLD_MS;
    if (!paused && !sizeOpen()) {
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
      bypassTicks = 0;
      return;
    }
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
      stopLoops();
      bypassTicks = 0;
      guardTimer = setInterval(guardTick, GUARD_INTERVAL_MS);
    }
  };

  return {
    attach() {
      if (pollTimer !== null || guardTimer !== null) return;
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
