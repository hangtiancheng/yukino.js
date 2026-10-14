import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { jsx } from "@/jsx-runtime";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  return () => {
    container.remove();
  };
});

const options = () => [
  jsx("option", { value: "a", children: "A" }),
  jsx("option", { value: "b", children: "B" }),
  jsx("option", { value: "c", children: "C" }),
];

const selectView = (props: Record<string, unknown>) =>
  jsx("select", { ...props, children: options() });

const selectEl = () => container.querySelector("select") as HTMLSelectElement;

describe("select value handling", () => {
  it("applies value on the initial render, after options commit", () => {
    render(selectView({ value: "b" }) as never, container);
    expect(selectEl().value).toBe("b");
    expect(selectEl().selectedIndex).toBe(1);
  });

  it("applies defaultValue on the initial render", () => {
    render(selectView({ defaultValue: "c" }) as never, container);
    expect(selectEl().value).toBe("c");
  });

  it("prefers value over defaultValue", () => {
    render(selectView({ value: "b", defaultValue: "c" }) as never, container);
    expect(selectEl().value).toBe("b");
  });

  it("coerces numeric values", () => {
    render(
      jsx("select", {
        value: 1,
        children: [
          jsx("option", { value: "0", children: "Zero" }),
          jsx("option", { value: "1", children: "One" }),
        ],
      }) as never,
      container,
    );
    expect(selectEl().value).toBe("1");
  });

  it("updates the selection when value changes between renders", () => {
    render(selectView({ value: "a" }) as never, container);
    const select = selectEl();
    expect(select.value).toBe("a");

    render(selectView({ value: "c" }) as never, container);
    expect(selectEl()).toBe(select);
    expect(select.value).toBe("c");
  });

  it("re-applies value on re-render (controlled semantics)", () => {
    render(selectView({ value: "b" }) as never, container);
    const select = selectEl();
    select.value = "c"; // user interaction without a state change
    render(selectView({ value: "b" }) as never, container);
    expect(select.value).toBe("b");
  });

  it("keeps user selection across re-renders for defaultValue (uncontrolled)", () => {
    render(selectView({ defaultValue: "b" }) as never, container);
    const select = selectEl();
    expect(select.value).toBe("b");

    select.value = "c";
    render(selectView({ defaultValue: "b" }) as never, container);
    expect(select.value).toBe("c");

    // a changed defaultValue is applied again
    render(selectView({ defaultValue: "a" }) as never, container);
    expect(select.value).toBe("a");
  });

  it("re-applies value when the option list changes", () => {
    render(selectView({ value: "b" }) as never, container);
    const select = selectEl();
    expect(select.value).toBe("b");

    render(
      jsx("select", {
        value: "b",
        children: [
          jsx("option", { value: "x", children: "X" }),
          jsx("option", { value: "b", children: "B" }),
        ],
      }) as never,
      container,
    );
    expect(select).toBe(selectEl());
    expect(select.value).toBe("b");
  });

  it("applies value when options render dynamically from data", () => {
    const items = [
      { id: "0", label: "P0" },
      { id: "1", label: "P1" },
    ];
    const view = (priority: string) =>
      jsx("select", {
        value: priority,
        children: items.map((item) =>
          jsx("option", { value: item.id, children: item.label }),
        ),
      });

    render(view("1") as never, container);
    expect(selectEl().value).toBe("1");
    render(view("0") as never, container);
    expect(selectEl().value).toBe("0");
  });

  it("leaves selects without value props untouched (first option selected)", () => {
    render(selectView({}) as never, container);
    expect(selectEl().value).toBe("a");
    expect(selectEl().selectedIndex).toBe(0);
  });

  it("does not set value when value props are nullish", () => {
    render(
      selectView({ value: undefined, defaultValue: null }) as never,
      container,
    );
    expect(selectEl().value).toBe("a");
  });

  it("keeps other select props working through spread (name, disabled, onChange)", () => {
    const onChange = vi.fn();
    render(
      jsx("select", {
        name: "priority",
        disabled: true,
        value: "b",
        onChange,
        children: options(),
      }) as never,
      container,
    );
    const select = selectEl();
    expect(select.name).toBe("priority");
    expect(select.disabled).toBe(true);
    expect(select.hasAttribute("disabled")).toBe(true);
    expect(select.value).toBe("b");

    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("does not leak a defaultValue expando onto the element", () => {
    render(selectView({ defaultValue: "b" }) as never, container);
    expect(
      Object.prototype.hasOwnProperty.call(selectEl(), "defaultValue"),
    ).toBe(false);
  });

  it("selects every matching option for array values (multiple)", () => {
    render(
      jsx("select", {
        multiple: true,
        value: ["a", "c"],
        children: options(),
      }) as never,
      container,
    );
    const selected = Array.from(selectEl().options)
      .filter((option) => option.selected)
      .map((option) => option.value);
    expect(selected).toEqual(["a", "c"]);
  });

  it("keeps the same element when value props appear or disappear", () => {
    render(selectView({}) as never, container);
    const select = selectEl();
    expect(select.value).toBe("a");

    render(selectView({ value: "b" }) as never, container);
    expect(selectEl()).toBe(select);
    expect(select.value).toBe("b");

    render(selectView({}) as never, container);
    expect(selectEl()).toBe(select);
    // no value prop anymore: the current selection is kept
    expect(select.value).toBe("b");
  });

  it("supports the option-selected pattern alongside (no value prop)", () => {
    render(
      jsx("select", {
        children: [
          jsx("option", { value: "a", selected: false, children: "A" }),
          jsx("option", { value: "b", selected: true, children: "B" }),
        ],
      }) as never,
      container,
    );
    expect(selectEl().value).toBe("b");
  });
});
