import { describe, it, expect, vi } from "vitest";
import { createStore } from "../src/store";
import { effect } from "../src/reactive";

interface CountState {
  count: number;
  step: number;
  increment: () => void;
}

function makeStore() {
  return createStore<CountState>((set, get) => ({
    count: 0,
    step: 1,
    increment() {
      set({ count: get().count + get().step });
    },
  }));
}

describe("createStore - subscribe", () => {
  it("subscribe fires on setState", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 5 });

    expect(listener).toHaveBeenCalledTimes(1);
    const [newState, prevState] = listener.mock.calls[0];
    expect(newState.count).toBe(5);
    expect(prevState.count).toBe(0);

    store.destroy();
  });

  it("subscribe fires on action call", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.getState().increment();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().count).toBe(1);

    store.destroy();
  });

  it("unsubscribe stops notifications", () => {
    const store = makeStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);

    off();
    store.setState({ count: 10 });

    expect(listener).not.toHaveBeenCalled();
    store.destroy();
  });

  it("setState with no actual change does not notify", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 0 }); // same as initial

    expect(listener).not.toHaveBeenCalled();
    store.destroy();
  });

  it("setState with updater function", () => {
    const store = makeStore();
    store.setState((prev) => ({ count: prev.count + 10 }));
    expect(store.getState().count).toBe(10);
    store.destroy();
  });

  it("destroy clears listeners", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.destroy();
    // setState after destroy is a no-op
    store.setState({ count: 99 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("getState (tracked proxy)", () => {
  it("returns a stable proxy identity", () => {
    const store = makeStore();
    expect(store.getState()).toBe(store.getState());
    store.destroy();
  });

  it("spread produces a plain snapshot including actions", () => {
    const store = makeStore();
    store.setState({ count: 3 });
    const snap = { ...store.getState() };
    expect(snap.count).toBe(3);
    expect(snap.step).toBe(1);
    expect(typeof snap.increment).toBe("function");
    store.destroy();
  });

  it("key reads inside an effect subscribe to THAT key only", () => {
    const store = makeStore();
    let runs = 0;
    const dispose = effect(() => {
      store.getState().count;
      runs++;
    });
    expect(runs).toBe(1);

    store.setState({ step: 5 }); // unread key → no re-run
    expect(runs).toBe(1);

    store.setState({ count: 1 });
    expect(runs).toBe(2);

    dispose();
    store.destroy();
  });

  it("batches multi-key setState into one effect run", () => {
    const store = makeStore();
    let runs = 0;
    const dispose = effect(() => {
      store.getState().count;
      store.getState().step;
      runs++;
    });
    expect(runs).toBe(1);

    store.setState({ count: 9, step: 9 });
    expect(runs).toBe(2);

    dispose();
    store.destroy();
  });

  it("setState can introduce new keys (zustand semantics)", () => {
    interface Extra {
      count: number;
      [k: string]: unknown;
    }
    const store = createStore<Extra>(() => ({ count: 0 }));
    store.setState({ label: "new" });
    expect(store.getState()["label"]).toBe("new");
    store.destroy();
  });
});
