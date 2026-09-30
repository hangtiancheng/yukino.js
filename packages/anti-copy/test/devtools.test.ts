import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAntiCopy, type AntiCopyInstance } from "@/index";

let instance: AntiCopyInstance | null = null;

function setWindowMetrics(outerWidth: number, innerWidth: number) {
  Object.defineProperty(window, "outerWidth", {
    value: outerWidth,
    configurable: true,
  });
  Object.defineProperty(window, "innerWidth", {
    value: innerWidth,
    configurable: true,
  });
  Object.defineProperty(window, "outerHeight", {
    value: 900,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 900,
    configurable: true,
  });
}

interface FakeWindow {
  outerWidth: number;
  innerWidth: number;
  outerHeight: number;
  innerHeight: number;
  performance: { now: () => number };
  location: { href: string };
  top: unknown;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/**
 * A stand-in window: metrics are plain fields, `performance.now` makes every
 * probe measure `probeCost` ms (second call of the pair returns the cost),
 * and each `location.href` assignment is recorded.
 */
function createFakeWindow() {
  let calls = 0;
  let probeCost = 0;
  const hrefSets: string[] = [];
  const view: FakeWindow = {
    outerWidth: 1200,
    innerWidth: 1200,
    outerHeight: 900,
    innerHeight: 900,
    performance: {
      now: () => (calls++ % 2 === 1 ? probeCost : 0),
    },
    location: {
      get href() {
        return "https://example.test/page";
      },
      set href(url: string) {
        hrefSets.push(url);
      },
    },
    top: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return {
    view,
    hrefSets,
    /** Simulates the debugger statement pausing this many ms per probe. */
    probePausesFor(ms: number) {
      probeCost = ms;
    },
    /** 300px inner-width delta trips the default docked-DevTools threshold. */
    openDevtools() {
      view.innerWidth = 900;
    },
    closeDevtools() {
      view.innerWidth = 1200;
    },
  };
}

function fakeTarget(view: FakeWindow): Document {
  return { defaultView: view } as Document;
}

const REPORT_ONLY = {
  copy: false,
  keyboard: false,
  contextmenu: false,
  selectStyle: false,
  print: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  setWindowMetrics(1200, 1200);
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  vi.useRealTimers();
});

describe("devtools detector", () => {
  it("fires once per closed-to-open transition", () => {
    const onViolation = vi.fn();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      // freeze:false keeps this suite report-only — the real window cannot
      // simulate a paused probe and would hit the redirect fallback.
      devtools: { intervalMs: 100, threshold: 170, freeze: false },
      onViolation,
    });
    instance.enable();

    vi.advanceTimersByTime(300);
    expect(onViolation).not.toHaveBeenCalled();

    setWindowMetrics(1200, 900);
    vi.advanceTimersByTime(300);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({ type: "devtools" });

    // Still open: no repeated notifications.
    vi.advanceTimersByTime(500);
    expect(onViolation).toHaveBeenCalledTimes(1);

    // Close, then reopen: fires again.
    setWindowMetrics(1200, 1200);
    vi.advanceTimersByTime(200);
    setWindowMetrics(1200, 900);
    vi.advanceTimersByTime(200);
    expect(onViolation).toHaveBeenCalledTimes(2);
  });

  it("stops polling after disable", () => {
    const onViolation = vi.fn();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100, freeze: false },
      onViolation,
    });
    instance.enable();
    instance.disable();
    setWindowMetrics(1200, 900);
    vi.advanceTimersByTime(1000);
    expect(onViolation).not.toHaveBeenCalled();
  });

  it("update deep-merges nested devtools options", () => {
    const onViolation = vi.fn();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100, threshold: 400, freeze: false },
      onViolation,
    });
    instance.enable();
    // Patch only intervalMs; a shallow merge would reset threshold to 170
    // and the 300px delta below would then fire a false violation.
    instance.update({ devtools: { intervalMs: 50 } });
    setWindowMetrics(1200, 900);
    vi.advanceTimersByTime(500);
    expect(onViolation).not.toHaveBeenCalled();

    setWindowMetrics(1200, 700);
    vi.advanceTimersByTime(100);
    expect(onViolation).toHaveBeenCalledWith({ type: "devtools" });
  });
});

describe("devtools countermeasures", () => {
  it("stalls through the debugger probe and never redirects while it pauses", () => {
    const fake = createFakeWindow();
    const onViolation = vi.fn();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100 },
      onViolation,
      target: fakeTarget(fake.view),
    });
    instance.enable();

    // The probe pauses — an undocked DevTools window the size heuristic
    // cannot see — so DevTools counts as open.
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    expect(onViolation).toHaveBeenCalledTimes(1);

    // The guard loop keeps re-pausing; the stall is working, no redirect.
    vi.advanceTimersByTime(5000);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(fake.hrefSets).toEqual([]);

    // DevTools closed: drop back to slow polling, a reopen fires again.
    fake.probePausesFor(0);
    fake.closeDevtools();
    vi.advanceTimersByTime(20);
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    expect(onViolation).toHaveBeenCalledTimes(2);
    expect(fake.hrefSets).toEqual([]);
  });

  it("redirects to the blank page once when a confirmed stall is neutralized", () => {
    const fake = createFakeWindow();
    const onViolation = vi.fn();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100 },
      onViolation,
      target: fakeTarget(fake.view),
    });
    instance.enable();

    // Docked DevTools with an attached debugger: the stall engages.
    fake.openDevtools();
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(fake.hrefSets).toEqual([]);

    // "Deactivate breakpoints": DevTools stays docked while the probe
    // stops pausing. ~25 guard ticks later the page is evicted.
    fake.probePausesFor(0);
    vi.advanceTimersByTime(700);
    expect(fake.hrefSets).toEqual(["about:blank"]);

    // The redirect fires exactly once.
    vi.advanceTimersByTime(2000);
    expect(fake.hrefSets).toEqual(["about:blank"]);
  });

  it("stays report-only on a size-only detection (zoom false positive)", () => {
    const fake = createFakeWindow();
    const onViolation = vi.fn();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100 },
      onViolation,
      target: fakeTarget(fake.view),
    });
    instance.enable();

    // Browser zoom shrinks innerWidth past the threshold, but the probe
    // never pauses — DevTools is not actually open. The page must neither
    // enter the guard loop nor get evicted.
    fake.openDevtools();
    vi.advanceTimersByTime(3000);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({ type: "devtools" });
    expect(fake.hrefSets).toEqual([]);
  });

  it("honors a custom redirect target", () => {
    const fake = createFakeWindow();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100, redirectUrl: "https://example.test/home" },
      target: fakeTarget(fake.view),
    });
    instance.enable();
    fake.openDevtools();
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    fake.probePausesFor(0);
    vi.advanceTimersByTime(700);
    expect(fake.hrefSets).toEqual(["https://example.test/home"]);
  });

  it("can disable the redirect fallback", () => {
    const fake = createFakeWindow();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100, redirectUrl: false },
      target: fakeTarget(fake.view),
    });
    instance.enable();
    fake.openDevtools();
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    fake.probePausesFor(0);
    vi.advanceTimersByTime(1000);
    expect(fake.hrefSets).toEqual([]);
  });

  it("does not escalate to the guard loop when freeze is disabled", () => {
    const fake = createFakeWindow();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100, freeze: false },
      target: fakeTarget(fake.view),
    });
    instance.enable();
    fake.openDevtools();
    vi.advanceTimersByTime(2000);
    expect(fake.hrefSets).toEqual([]);
  });

  it("stops the guard loop after disable", () => {
    const fake = createFakeWindow();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100 },
      target: fakeTarget(fake.view),
    });
    instance.enable();
    fake.openDevtools();
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    instance.disable();
    fake.probePausesFor(0);
    vi.advanceTimersByTime(2000);
    expect(fake.hrefSets).toEqual([]);
  });

  it("re-arms after disable then enable following a redirect", () => {
    const fake = createFakeWindow();
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100 },
      target: fakeTarget(fake.view),
    });
    instance.enable();
    fake.openDevtools();
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    fake.probePausesFor(0);
    vi.advanceTimersByTime(700);
    expect(fake.hrefSets).toEqual(["about:blank"]);

    // The simulated navigation did not unload the page; a fresh
    // disable → enable cycle must protect again instead of staying dead.
    instance.disable();
    instance.enable();
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    fake.probePausesFor(0);
    vi.advanceTimersByTime(700);
    expect(fake.hrefSets).toEqual(["about:blank", "about:blank"]);
  });

  it("falls back to the own window when the top frame is cross-origin", () => {
    const fake = createFakeWindow();
    fake.view.top = {
      get location(): never {
        throw new Error("cross-origin");
      },
    };
    instance = createAntiCopy({
      ...REPORT_ONLY,
      devtools: { intervalMs: 100 },
      target: fakeTarget(fake.view),
    });
    instance.enable();
    fake.openDevtools();
    fake.probePausesFor(500);
    vi.advanceTimersByTime(100);
    fake.probePausesFor(0);
    vi.advanceTimersByTime(700);
    expect(fake.hrefSets).toEqual(["about:blank"]);
  });
});
