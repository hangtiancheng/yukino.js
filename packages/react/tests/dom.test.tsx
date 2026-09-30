import type { CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";
import { createElement, render } from "@yukino.js/react";
import type { Ref } from "@yukino.js/react";
import { click, createContainer } from "./helpers";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

describe("attributes and properties", () => {
  it("aliases className and htmlFor to class / for attributes", () => {
    const container = createContainer();
    render(
      <label className="lbl" htmlFor="field">
        name
      </label>,
      container,
    );
    const label = container.querySelector("label")!;
    expect(label.getAttribute("class")).toBe("lbl");
    expect(label.getAttribute("for")).toBe("field");

    render(<label>name</label>, container);
    expect(label.hasAttribute("class")).toBe(false);
    expect(label.hasAttribute("for")).toBe(false);
  });

  it("writes controlled props like value and checked as properties", () => {
    const container = createContainer();
    render(
      <div>
        <input value="abc" />
        <input type="checkbox" checked={true} />
      </div>,
      container,
    );
    const [text, box] = [...container.querySelectorAll("input")];
    expect(text.value).toBe("abc");
    expect(box.checked).toBe(true);

    render(
      <div>
        <input value="xyz" />
        <input type="checkbox" checked={false} />
      </div>,
      container,
    );
    expect(text.value).toBe("xyz");
    expect(box.checked).toBe(false);
  });

  it("toggles boolean-ish attributes through the property path", () => {
    const container = createContainer();
    render(<button disabled={true}>b</button>, container);
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    render(<button disabled={false}>b</button>, container);
    expect(button.disabled).toBe(false);
  });
});

describe("style", () => {
  it("applies object styles with px suffix for dimensional numbers", () => {
    const container = createContainer();
    render(
      <div style={{ width: 100, opacity: 0.5, zIndex: 3 }}>s</div>,
      container,
    );
    const div = container.querySelector("div")!;
    expect(div.style.width).toBe("100px");
    expect(div.style.opacity).toBe("0.5");
    expect(div.style.zIndex).toBe("3");
  });

  it("diffs object styles, clearing removed keys", () => {
    const container = createContainer();
    render(<div style={{ width: 100, color: "red" }}>s</div>, container);
    const div = container.querySelector("div")!;
    render(<div style={{ color: "blue" }}>s</div>, container);
    expect(div.style.width).toBe("");
    expect(div.style.color).toBe("blue");
  });

  it("supports string styles, custom properties and full removal", () => {
    const container = createContainer();
    render(createElement("div", { style: "color: red" }, "s"), container);
    const div = container.querySelector("div")!;
    expect(div.style.color).toBe("red");

    render(
      <div style={{ "--accent": "green" } as CSSProperties}>s</div>,
      container,
    );
    expect(div.style.getPropertyValue("--accent")).toBe("green");

    render(<div>s</div>, container);
    expect(div.style.cssText).toBe("");
  });
});

describe("events", () => {
  it("swaps and removes listeners across renders", () => {
    const container = createContainer();
    const first = vi.fn();
    const second = vi.fn();

    render(<button onClick={first}>b</button>, container);
    const button = container.querySelector("button")!;
    click(button);
    expect(first).toHaveBeenCalledTimes(1);

    render(<button onClick={second}>b</button>, container);
    click(button);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    render(<button>b</button>, container);
    click(button);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("delivers the native event with the element as currentTarget", () => {
    const container = createContainer();
    let seen: MouseEvent | null = null;
    render(
      <button
        onClick={(event) => {
          seen = event;
        }}
      >
        b
      </button>,
      container,
    );
    const button = container.querySelector("button")!;
    click(button);
    expect(seen).toBeInstanceOf(MouseEvent);
  });
});

describe("dangerouslySetInnerHTML", () => {
  it("sets, updates and clears trusted HTML, skipping children", () => {
    const container = createContainer();
    render(
      <div dangerouslySetInnerHTML={{ __html: "<b>hi</b>" }}>ignored</div>,
      container,
    );
    const div = container.querySelector("div")!;
    expect(div.innerHTML).toBe("<b>hi</b>");

    render(
      <div dangerouslySetInnerHTML={{ __html: "<i>yo</i>" }} />,
      container,
    );
    expect(div.innerHTML).toBe("<i>yo</i>");

    render(<div>plain</div>, container);
    expect(div.innerHTML).toBe("plain");
  });
});

describe("svg", () => {
  it("creates svg descendants in the SVG namespace and escapes via foreignObject", () => {
    const container = createContainer();
    render(
      <svg viewBox="0 0 10 10" className="icon">
        <path d="M0 0" />
        <foreignObject>
          <div>html</div>
        </foreignObject>
      </svg>,
      container,
    );
    const svg = container.querySelector("svg")!;
    const path = container.querySelector("path")!;
    const div = container.querySelector("div")!;
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(path.namespaceURI).toBe(SVG_NS);
    expect(svg.getAttribute("class")).toBe("icon");
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(div.namespaceURI).toBe(XHTML_NS);
  });
});

describe("refs", () => {
  it("assigns object refs on mount and nulls them on unmount", () => {
    const container = createContainer();
    const ref: { current: HTMLDivElement | null } = { current: null };
    render(<div ref={ref} />, container);
    expect(ref.current).toBe(container.querySelector("div"));
    render(null, container);
    expect(ref.current).toBe(null);
  });

  it("calls function refs with the element, then with null on unmount", () => {
    const container = createContainer();
    const calls: Array<Element | null> = [];
    render(<div ref={(el) => void calls.push(el)} />, container);
    const div = container.querySelector("div");
    expect(calls).toEqual([div]);
    render(null, container);
    expect(calls).toEqual([div, null]);
  });

  it("prefers a returned ref cleanup over calling back with null", () => {
    const container = createContainer();
    const log: string[] = [];
    const ref: Ref<HTMLDivElement> = (el) => {
      log.push(el === null ? "null" : "attach");
      return () => log.push("cleanup");
    };
    render(<div ref={ref} />, container);
    expect(log).toEqual(["attach"]);
    render(null, container);
    expect(log).toEqual(["attach", "cleanup"]);
  });

  it("detaches the old ref and attaches the new one when the prop changes", () => {
    const container = createContainer();
    const first: { current: HTMLDivElement | null } = { current: null };
    const second: { current: HTMLDivElement | null } = { current: null };
    render(<div ref={first} />, container);
    const div = container.querySelector("div");
    expect(first.current).toBe(div);
    render(<div ref={second} />, container);
    expect(first.current).toBe(null);
    expect(second.current).toBe(div);
  });
});
