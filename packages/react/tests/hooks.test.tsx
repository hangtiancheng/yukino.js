import { describe, expect, it, vi } from "vitest";
import {
  render,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "@yukino.js/react";
import { click, createContainer, flush } from "./helpers";

describe("useState", () => {
  it("batches multiple setStates from one tick into a single re-render", async () => {
    const container = createContainer();
    let renders = 0;
    function Counter() {
      renders++;
      const [n, setN] = useState(0);
      return (
        <button
          onClick={() => {
            setN((prev) => prev + 1);
            setN((prev) => prev + 1);
          }}
        >
          {n}
        </button>
      );
    }
    render(<Counter />, container);
    expect(renders).toBe(1);

    click(container.querySelector("button")!);
    await flush();
    expect(container.textContent).toBe("2");
    expect(renders).toBe(2);
  });

  it("bails out eagerly when the next state is identical", async () => {
    const container = createContainer();
    let renders = 0;
    function Same() {
      renders++;
      const [n, setN] = useState(5);
      return <button onClick={() => setN(5)}>{n}</button>;
    }
    render(<Same />, container);
    click(container.querySelector("button")!);
    await flush();
    expect(renders).toBe(1);
  });

  it("calls a lazy initializer exactly once", async () => {
    const container = createContainer();
    let inits = 0;
    function Lazy() {
      const [n, setN] = useState(() => {
        inits++;
        return 1;
      });
      return <button onClick={() => setN(n + 1)}>{n}</button>;
    }
    render(<Lazy />, container);
    click(container.querySelector("button")!);
    await flush();
    expect(container.textContent).toBe("2");
    expect(inits).toBe(1);
  });

  it("throws when called outside a component", () => {
    expect(() => useState(0)).toThrow(
      "Hooks can only be called inside a function component.",
    );
  });
});

describe("useMemo / useCallback / useRef", () => {
  it("recomputes memo only when deps change; keeps callback and ref identity", () => {
    const container = createContainer();
    let computes = 0;
    const seenCallbacks: Array<() => void> = [];
    const seenRefs: Array<{ current: number }> = [];
    function Memo(props: { dep: number; other: number }) {
      const value = useMemo(() => {
        computes++;
        return props.dep * 2;
      }, [props.dep]);
      seenCallbacks.push(useCallback(() => {}, []));
      seenRefs.push(useRef(0));
      return <output>{value}</output>;
    }
    render(<Memo dep={1} other={0} />, container);
    render(<Memo dep={1} other={1} />, container);
    expect(computes).toBe(1);
    render(<Memo dep={2} other={1} />, container);
    expect(computes).toBe(2);
    expect(container.textContent).toBe("4");
    expect(seenCallbacks[0]).toBe(seenCallbacks[1]);
    expect(seenCallbacks[1]).toBe(seenCallbacks[2]);
    expect(seenRefs[0]).toBe(seenRefs[2]);
  });
});

describe("useEffect", () => {
  it("runs after commit, re-runs on deps change, cleans up before re-run", () => {
    const container = createContainer();
    const log: string[] = [];
    function Fx(props: { dep: number }) {
      useEffect(() => {
        log.push(`create ${props.dep}`);
        return () => log.push(`cleanup ${props.dep}`);
      }, [props.dep]);
      return <i />;
    }
    render(<Fx dep={1} />, container);
    expect(log).toEqual(["create 1"]);
    render(<Fx dep={1} />, container);
    expect(log).toEqual(["create 1"]);
    render(<Fx dep={2} />, container);
    expect(log).toEqual(["create 1", "cleanup 1", "create 2"]);
  });

  it("orders both cleanups and creates children before parents", () => {
    const container = createContainer();
    const log: string[] = [];
    function Child() {
      useEffect(() => {
        log.push("child create");
        return () => log.push("child cleanup");
      });
      return <span />;
    }
    function Parent() {
      useEffect(() => {
        log.push("parent create");
        return () => log.push("parent cleanup");
      });
      return <Child />;
    }
    render(<Parent />, container);
    expect(log).toEqual(["child create", "parent create"]);

    render(<Parent />, container);
    expect(log).toEqual([
      "child create",
      "parent create",
      "child cleanup",
      "parent cleanup",
      "child create",
      "parent create",
    ]);

    log.length = 0;
    render(null, container);
    expect(log).toEqual(["child cleanup", "parent cleanup"]);
  });

  it("supports setState inside an effect (cascading wave)", async () => {
    const container = createContainer();
    function Cascade() {
      const [n, setN] = useState(0);
      useEffect(() => {
        if (n === 0) {
          setN(1);
        }
      }, [n]);
      return <output>{n}</output>;
    }
    render(<Cascade />, container);
    await flush();
    expect(container.textContent).toBe("1");
  });
});

describe("runaway update guard", () => {
  it("throws Maximum update depth exceeded instead of looping forever", () => {
    const tasks: Array<() => void> = [];
    const spy = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((task) => {
        tasks.push(task as () => void);
      });
    try {
      const container = createContainer();
      function Loop() {
        const [n, setN] = useState(0);
        useEffect(() => {
          setN(n + 1);
        });
        return <output>{n}</output>;
      }
      render(<Loop />, container);

      let caught: unknown = null;
      let waves = 0;
      try {
        while (tasks.length > 0 && waves < 1000) {
          waves++;
          tasks.shift()!();
        }
      } catch (error) {
        caught = error;
      }
      expect(String(caught)).toContain("Maximum update depth exceeded");
      expect(waves).toBeLessThan(100);
      expect(tasks.length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
