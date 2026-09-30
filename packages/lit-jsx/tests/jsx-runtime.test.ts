import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { jsx, Fragment } from "../src/jsx-runtime";
import { customElement } from "../src/decorators";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  return () => {
    container.remove();
  };
});

describe("jsx runtime component handling", () => {
  it("invokes functional components with their props", () => {
    const Greeting = ({ name }: { name: string }) =>
      jsx("div", { children: `hi ${name}` });
    render(jsx(Greeting, { name: "ada" }) as never, container);
    expect(container.querySelector("div")?.textContent).toBe("hi ada");
  });

  it("renders fragments as lists of children", () => {
    const fragment = Fragment({
      children: [
        jsx("span", { children: "a" }),
        jsx("span", { children: "b" }),
      ],
    });
    expect(Array.isArray(fragment)).toBe(true);
    render(fragment as never, container);
    expect(container.querySelectorAll("span")).toHaveLength(2);
  });

  it("wraps a single fragment child in an array", () => {
    const child = jsx("span", { children: "only" });
    const fragment = Fragment({ children: child });
    expect(Array.isArray(fragment)).toBe(true);
    expect(fragment).toHaveLength(1);
    render(fragment as never, container);
    expect(container.querySelector("span")?.textContent).toBe("only");
  });

  it("renders custom element classes via their registered tag name", () => {
    @customElement("wc-counter")
    class WcCounter extends HTMLElement {}

    render(jsx(WcCounter, { count: 3 }) as never, container);
    const el = container.querySelector("wc-counter");
    expect(el).toBeTruthy();
    expect((el as { count?: unknown }).count).toBe(3);
  });

  it("forwards props as properties and does not auto-bind events on custom elements", () => {
    class MyWidget extends HTMLElement {}
    customElements.define("my-widget", MyWidget);

    const onClick = vi.fn();
    render(jsx("my-widget", { widgetName: "x", onClick }) as never, container);
    const el = container.querySelector("my-widget") as HTMLElement;
    expect(el).toBeTruthy();
    expect((el as { widgetName?: unknown }).widgetName).toBe("x");

    el.dispatchEvent(new Event("click"));
    expect(onClick).not.toHaveBeenCalled();
    expect((el as { onClick?: unknown }).onClick).toBe(onClick);
  });
});
