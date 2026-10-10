import { describe, expect, it } from "vitest";
import { createStore, render, useEffect, useStore } from "@yukino.js/react";
import { createContainer, flush } from "./helpers";

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

describe("useStore", () => {
  it("re-renders the component when the store changes", async () => {
    const store = makeStore();
    const container = createContainer();

    function Counter() {
      const count = useStore(store, (s) => s.count);
      return <p>{count}</p>;
    }

    render(<Counter />, container);
    expect(container.textContent).toBe("0");

    store.setState({ count: 5 });
    await flush();
    expect(container.textContent).toBe("5");

    store.getState().increment();
    await flush();
    expect(container.textContent).toBe("6");

    render(null, container);
    store.destroy();
  });

  it("whole-state form re-renders on any change", async () => {
    const store = makeStore();
    const container = createContainer();

    function Snapshot() {
      const state = useStore(store);
      return <p>{`${state.count}:${state.step}`}</p>;
    }

    render(<Snapshot />, container);
    expect(container.textContent).toBe("0:1");

    store.setState({ step: 4 });
    await flush();
    expect(container.textContent).toBe("0:4");

    render(null, container);
    store.destroy();
  });

  it("selector skips unrelated-key writes", async () => {
    const store = makeStore();
    const container = createContainer();
    let renders = 0;

    function Counter() {
      renders++;
      const count = useStore(store, (s) => s.count);
      return <p>{count}</p>;
    }

    render(<Counter />, container);
    expect(renders).toBe(1);

    store.setState({ step: 9 });
    await flush();
    expect(renders).toBe(1);

    store.setState({ count: 2 });
    await flush();
    expect(renders).toBe(2);
    expect(container.textContent).toBe("2");

    render(null, container);
    store.destroy();
  });

  it("catches a write that lands before the subscription (mount-effect write)", async () => {
    const store = makeStore();
    const container = createContainer();

    function Writer() {
      useEffect(() => {
        store.setState({ count: 1 });
      }, []);
      return null;
    }

    function Reader() {
      const count = useStore(store, (s) => s.count);
      return <p>{count}</p>;
    }

    render(
      <div>
        <Writer />
        <Reader />
      </div>,
      container,
    );
    expect(container.textContent).toBe("0");

    await flush();
    expect(container.textContent).toBe("1");

    render(null, container);
    store.destroy();
  });

  it("one setState re-renders all subscribed components in one wave", async () => {
    const store = makeStore();
    const container = createContainer();
    let aRenders = 0;
    let bRenders = 0;

    function A() {
      aRenders++;
      return <i>{useStore(store, (s) => s.count)}</i>;
    }
    function B() {
      bRenders++;
      return <b>{useStore(store, (s) => s.count)}</b>;
    }

    render(
      <div>
        <A />
        <B />
      </div>,
      container,
    );
    expect(aRenders).toBe(1);
    expect(bRenders).toBe(1);

    store.setState({ count: 7 });
    await flush();
    expect(aRenders).toBe(2);
    expect(bRenders).toBe(2);
    expect(container.textContent).toBe("77");

    render(null, container);
    store.destroy();
  });

  it("unmount unsubscribes", async () => {
    const store = makeStore();
    const container = createContainer();
    let renders = 0;

    function Counter() {
      renders++;
      return <p>{useStore(store, (s) => s.count)}</p>;
    }

    render(<Counter />, container);
    render(null, container);
    expect(renders).toBe(1);

    store.setState({ count: 42 });
    await flush();
    expect(renders).toBe(1);

    store.destroy();
  });

  it("supports inline selectors (fresh identity per render)", async () => {
    const store = makeStore();
    const container = createContainer();

    function Doubled() {
      const doubled = useStore(store, (s) => s.count * 2);
      return <p>{doubled}</p>;
    }

    render(<Doubled />, container);
    expect(container.textContent).toBe("0");

    store.setState({ count: 3 });
    await flush();
    expect(container.textContent).toBe("6");

    render(null, container);
    store.destroy();
  });
});
