import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, unmount } from "../src/jsx/reconcile";
import { useRef } from "../src/hooks";
import { signal } from "../src/reactive";
import type { HTMLAttributes } from "../src/jsx/dom-types";

declare module "@yukino.js/react-signal/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "my-widget": HTMLAttributes<HTMLElement> & { whatever?: number };
    }
  }
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  host.id = "jsx-types-host";
  document.body.appendChild(host);
});

afterEach(() => {
  unmount(host);
  host.remove();
});

describe("jsx types — per-tag attributes", () => {
  it("accepts valid per-tag attributes and rejects unknown ones", () => {
    render(
      <a href="/docs" target="_blank" rel="noreferrer">
        docs
      </a>,
      host,
    );
    expect(host.querySelector("a")!.getAttribute("target")).toBe("_blank");

    // @ts-expect-error — unknown attribute on a known tag
    render(<div bogus={1} />, host);
    // @ts-expect-error — value is not a boolean-typed attribute
    render(<input value={true} />, host);
    // @ts-expect-error — no dangerouslySetInnerHTML; raw() is the only trusted-HTML path
    render(<div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />, host);
    // @ts-expect-error — preact's `jsx` marker prop is not part of Yukino's surface
    render(<div jsx={true} />, host);
    // @ts-expect-error — key is string | number (never preact's `any`)
    render(<div key={{}} />, host);
  });

  it("types event handlers with native events and per-tag currentTarget", () => {
    const clientXs: number[] = [];
    const values: string[] = [];
    render(
      <div>
        <button onClick={(e) => clientXs.push(e.clientX)}>go</button>
        <input onInput={(e) => values.push(e.currentTarget.value)} />
      </div>,
      host,
    );
    host
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = host.querySelector("input")!;
    input.value = "typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(clientXs).toEqual([0]);
    expect(values).toEqual(["typed"]);

    // @ts-expect-error — keyboard handler is not a mouse handler
    render(<button onClick={(e: KeyboardEvent) => e.key} />, host);
    // @ts-expect-error — capture-phase props are not wireable (name.slice(2).toLowerCase())
    render(<button onClickCapture={() => undefined} />, host);
  });

  it("types refs strictly per tag", () => {
    function Form() {
      const typed = useRef<HTMLInputElement>();
      const bare = useRef();
      return (
        <form>
          <input ref={typed} />
          {/* @ts-expect-error — Element-typed cell is not a per-tag ref; use useRef<HTMLParagraphElement>() */}
          <p ref={bare} />
          <textarea
            ref={(el) => void (el satisfies HTMLTextAreaElement | null)}
          />
        </form>
      );
    }
    render(<Form />, host);
    expect(host.querySelector("form")).not.toBeNull();
  });

  it("accepts yukino class/style shapes and signal-valued attributes", () => {
    const title = signal("from-signal");
    render(
      <div
        class={["a", false, { b: true, c: 0 }, ["d"]]}
        style={{ backgroundColor: "red", "--x": "1px" }}
        title={title}
        data-id="x1"
      />,
      host,
    );
    const el = host.firstElementChild!;
    expect(el.className).toBe("a b d");
    expect(el.getAttribute("style")).toContain("background-color:red");
    expect(el.getAttribute("title")).toBe("from-signal");
    expect(el.getAttribute("data-id")).toBe("x1");
  });

  it("rejects unknown tags and types custom elements via module augmentation", () => {
    // @ts-expect-error — unknown tags are compile errors (strict IntrinsicElements)
    render(<dvi />, host);

    const keys: string[] = [];
    render(
      <my-widget whatever={1} class="w" onKeyDown={(e) => keys.push(e.key)} />,
      host,
    );
    const widget = host.querySelector("my-widget")!;
    expect(widget.getAttribute("whatever")).toBe("1");
    expect(widget.className).toBe("w");
    widget.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(keys).toEqual(["Enter"]);

    // @ts-expect-error — augmented custom elements are typed too
    render(<my-widget whatever="not-a-number" />, host);
  });

  it("types svg tags via SVGAttributes", () => {
    render(
      <svg viewBox="0 0 10 10">
        <circle cx={5} cy={5} r={4} fill="red" />
      </svg>,
      host,
    );
    const circle = host.querySelector("circle")!;
    expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(circle.getAttribute("fill")).toBe("red");
  });
});
