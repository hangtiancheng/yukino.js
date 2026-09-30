import { describe, expect, it } from "vitest";
import { createElement, Fragment as IndexFragment } from "@yukino.js/react";
import { Fragment, jsx, jsxs } from "@yukino.js/react/jsx-runtime";
import { jsxDEV } from "@yukino.js/react/jsx-dev-runtime";

describe("jsx / jsxs", () => {
  it("builds a descriptor with children inside props and empty instance fields", () => {
    const child = jsx("span", {});
    const vnode = jsx("div", { id: "a", children: child });
    expect(vnode.type).toBe("div");
    expect(vnode.key).toBe(null);
    expect(vnode.props.id).toBe("a");
    expect(vnode.props.children).toBe(child);
    expect(vnode.dom).toBe(null);
    expect(vnode.children).toBe(null);
    expect(vnode.hooks).toBe(null);
  });

  it("coerces the key argument to a string, null when absent", () => {
    expect(jsx("div", {}, 1).key).toBe("1");
    expect(jsx("div", {}, "k").key).toBe("k");
    expect(jsx("div", {}, null).key).toBe(null);
    expect(jsx("div", {}).key).toBe(null);
  });

  it("reuses the compiler-owned props object verbatim, even frozen", () => {
    const props = Object.freeze({ id: "frozen" });
    const vnode = jsx("div", props);
    expect(vnode.props).toBe(props);
  });

  it("normalizes null props to an empty object", () => {
    expect(jsx("div", null).props).toEqual({});
  });

  it("jsxs is the same function; jsxDEV delegates and ignores dev metadata", () => {
    expect(jsxs).toBe(jsx);
    const vnode = jsxDEV("p", { children: "x" }, "k", false, {}, undefined);
    expect(vnode.type).toBe("p");
    expect(vnode.key).toBe("k");
    expect(vnode.props.children).toBe("x");
  });

  it("exports the same Fragment symbol as the package entry", () => {
    expect(Fragment).toBe(IndexFragment);
    expect(typeof Fragment).toBe("symbol");
  });
});

describe("createElement (classic)", () => {
  it("extracts key from config and merges variadic children", () => {
    const single = createElement("div", { key: 7, id: "a" }, "only");
    expect(single.key).toBe("7");
    expect(single.props.id).toBe("a");
    expect(single.props.children).toBe("only");
    expect("key" in single.props).toBe(false);

    const multiple = createElement("ul", null, "a", "b");
    expect(multiple.props.children).toEqual(["a", "b"]);

    const none = createElement("br");
    expect("children" in none.props).toBe(false);
  });
});
