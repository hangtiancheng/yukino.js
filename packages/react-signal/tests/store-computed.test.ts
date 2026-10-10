import { describe, it, expect } from "vitest";
import { createStore } from "../src/store";
import { computed, effect } from "../src/reactive";
import type { StoreApi } from "../src/store";

interface CountState {
  count: number;
  doubled: number;
  countPlusTen: number;
  increment: () => void;
}

function makeCountStore(): StoreApi<CountState> {
  return createStore<CountState>((set, get) => ({
    count: 1,
    doubled: computed(() => get().count * 2),
    countPlusTen: computed(() => get().count + 10),
    increment() {
      set({ count: get().count + 1 });
    },
  }));
}

describe("createStore - computed", () => {
  it("computes an initial value from its deps", () => {
    const store = makeCountStore();
    const state = store.getState();
    expect(state.count).toBe(1);
    expect(state.doubled).toBe(2);
    expect(state.countPlusTen).toBe(11);
    store.destroy();
  });

  it("recomputes when a dep changes via setState", () => {
    const store = makeCountStore();
    store.setState({ count: 5 });
    expect(store.getState().doubled).toBe(10);
    expect(store.getState().countPlusTen).toBe(15);
    store.destroy();
  });

  it("recomputes when a dep changes via action", () => {
    const store = makeCountStore();
    store.getState().increment();
    expect(store.getState().count).toBe(2);
    expect(store.getState().doubled).toBe(4);
    expect(store.getState().countPlusTen).toBe(12);
    store.destroy();
  });

  it("writes to a computed key via setState are ignored", () => {
    const store = makeCountStore();
    store.setState({ doubled: 999 } as Partial<CountState>);
    expect(store.getState().doubled).toBe(2);
    store.destroy();
  });

  it("multiple computeds with the same dep all update together", () => {
    const store = makeCountStore();
    store.getState().increment();
    store.getState().increment();
    expect(store.getState().count).toBe(3);
    expect(store.getState().doubled).toBe(6);
    expect(store.getState().countPlusTen).toBe(13);
    store.destroy();
  });

  it("computed store reads are tracked — effects re-run on dep changes", () => {
    const store = makeCountStore();
    const seen: number[] = [];
    const dispose = effect(() => {
      seen.push(store.getState().doubled);
    });
    expect(seen).toEqual([2]);

    store.setState({ count: 4 });
    expect(seen).toEqual([2, 8]);

    dispose();
    store.destroy();
  });

  it("does not recompute when an unrelated key changes", () => {
    interface S2 {
      a: number;
      b: number;
      derived: number;
    }
    let computes = 0;
    const store = createStore<S2>((_set, get) => ({
      a: 1,
      b: 100,
      derived: computed(() => {
        computes++;
        return get().a * 10;
      }),
    }));
    expect(store.getState().derived).toBe(10);
    const before = computes;

    store.setState({ b: 200 });
    expect(store.getState().derived).toBe(10);
    expect(computes).toBe(before);

    store.setState({ a: 2 });
    expect(store.getState().derived).toBe(20);
    expect(computes).toBeGreaterThan(before);
    store.destroy();
  });
});
