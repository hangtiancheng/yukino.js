import { describe, expect, it } from "vitest";
import { render, useState } from "@yukino.js/react";
import { click, createContainer, flush } from "./helpers";

function Item(props: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <li onClick={() => setCount(count + 1)}>
      {props.label}:{count}
    </li>
  );
}

function List(props: { order: string[] }) {
  return (
    <ul>
      {props.order.map((id) => (
        <Item key={id} label={id} />
      ))}
    </ul>
  );
}

describe("keyed diff", () => {
  it("reorders by key, preserving DOM identity and hook state", async () => {
    const container = createContainer();
    render(<List order={["a", "b", "c"]} />, container);
    const [a, b, c] = [...container.querySelectorAll("li")];

    click(a);
    await flush();
    expect(a.textContent).toBe("a:1");

    render(<List order={["c", "a", "b"]} />, container);
    const after = [...container.querySelectorAll("li")];
    expect(after[0]).toBe(c);
    expect(after[1]).toBe(a);
    expect(after[2]).toBe(b);
    expect(after[1].textContent).toBe("a:1");
  });

  it("removes dropped keys and mounts new ones in position", () => {
    const container = createContainer();
    render(<List order={["a", "b", "c"]} />, container);
    const [a, , c] = [...container.querySelectorAll("li")];

    render(<List order={["c", "new", "a"]} />, container);
    const after = [...container.querySelectorAll("li")];
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(c);
    expect(after[1].textContent).toBe("new:0");
    expect(after[2]).toBe(a);
  });

  it("appends and truncates at the tail through the positional pass", () => {
    const container = createContainer();
    render(<List order={["a"]} />, container);
    const [a] = [...container.querySelectorAll("li")];

    render(<List order={["a", "b"]} />, container);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("li")[0]).toBe(a);

    render(<List order={["a"]} />, container);
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelectorAll("li")[0]).toBe(a);
  });

  it("treats a same-key type change as unmount + create", () => {
    const container = createContainer();
    render(
      <div>
        <span key="k">old</span>
      </div>,
      container,
    );
    const span = container.querySelector("span");
    render(
      <div>
        <em key="k">new</em>
      </div>,
      container,
    );
    expect(container.innerHTML).toBe("<div><em>new</em></div>");
    expect(container.querySelector("em")).not.toBe(span);
  });

  it("keeps keyless siblings matched by index", () => {
    const container = createContainer();
    render(
      <div>
        <span>1</span>
        <span>2</span>
      </div>,
      container,
    );
    const [first, second] = [...container.querySelectorAll("span")];
    render(
      <div>
        <span>1x</span>
        <span>2x</span>
      </div>,
      container,
    );
    const [afterFirst, afterSecond] = [...container.querySelectorAll("span")];
    expect(afterFirst).toBe(first);
    expect(afterSecond).toBe(second);
  });
});
