import { describe, expect, it } from "vitest";
import {
  hotSwapByComponent,
  render,
  useEffect,
  useMemo,
  useState,
} from "@yukino.js/react";
import { click, createContainer, flush } from "./helpers";

describe("hotSwapByComponent", () => {
  it("swaps the live instance body while preserving useState state", async () => {
    const container = createContainer();
    function CounterV1() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>v1:{n}</button>;
    }
    function CounterV2() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>v2:{n}</button>;
    }

    render(<CounterV1 />, container);
    click(container.querySelector("button")!);
    await flush();
    expect(container.textContent).toBe("v1:1");

    // root.element still references CounterV1 — the stale-descriptor case
    expect(hotSwapByComponent(CounterV1, CounterV2)).toBe(true);
    await flush();
    expect(container.textContent).toBe("v2:1");

    // the swapped instance stays interactive
    click(container.querySelector("button")!);
    await flush();
    expect(container.textContent).toBe("v2:2");
  });

  it("preserves parent state and useMemo-cached child elements", async () => {
    const container = createContainer();
    function ChildV1() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>c1:{n}</button>;
    }
    function ChildV2() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>c2:{n}</button>;
    }
    function Parent() {
      const [label, setLabel] = useState("p0");
      // stale-descriptor case: the cached element captures ChildV1 forever
      const cached = useMemo(() => <ChildV1 />, []);
      return (
        <div>
          <output onClick={() => setLabel("p1")}>{label}</output>
          {cached}
        </div>
      );
    }

    render(<Parent />, container);
    click(container.querySelector("output")!);
    click(container.querySelector("button")!);
    await flush();
    expect(container.textContent).toBe("p1c1:1");

    hotSwapByComponent(ChildV1, ChildV2);
    await flush();
    expect(container.textContent).toBe("p1c2:1");
  });

  it("survives an edit-revert ping-pong without cycling", async () => {
    const container = createContainer();
    function A() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>a:{n}</button>;
    }
    function B() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>b:{n}</button>;
    }

    render(<A />, container);
    click(container.querySelector("button")!);
    await flush();

    hotSwapByComponent(A, B);
    await flush();
    expect(container.textContent).toBe("b:1");

    hotSwapByComponent(B, A);
    await flush();
    expect(container.textContent).toBe("a:1");
  });

  it("destructively resets a slot whose hook tag changed", async () => {
    const container = createContainer();
    function V1() {
      const [n] = useState(41);
      return <output>{n}</output>;
    }
    function V2() {
      const label = useMemo(() => "memo", []);
      const [n] = useState(0);
      return (
        <output>
          {label}:{n}
        </output>
      );
    }

    render(<V1 />, container);
    expect(container.textContent).toBe("41");

    hotSwapByComponent(V1, V2);
    await flush();
    // slot 0 flipped state→memo (reset); slot 1 is a brand-new state slot
    expect(container.textContent).toBe("memo:0");
  });

  it("runs cleanups for trailing hooks the new body no longer reaches", async () => {
    const container = createContainer();
    const log: string[] = [];
    function WithEffect() {
      const [n] = useState(1);
      useEffect(() => {
        log.push("create");
        return () => log.push("cleanup");
      }, []);
      return <output>fx:{n}</output>;
    }
    function WithoutEffect() {
      const [n] = useState(1);
      return <output>plain:{n}</output>;
    }

    render(<WithEffect />, container);
    expect(log).toEqual(["create"]);

    hotSwapByComponent(WithEffect, WithoutEffect);
    await flush();
    expect(container.textContent).toBe("plain:1");
    expect(log).toEqual(["create", "cleanup"]);
  });

  it("no-ops on non-functions and identical references", () => {
    function Fn() {
      return null;
    }
    expect(hotSwapByComponent(null, Fn)).toBe(false);
    expect(hotSwapByComponent(Fn, "nope")).toBe(false);
    expect(hotSwapByComponent(Fn, Fn)).toBe(false);
  });
});
