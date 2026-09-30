// @vitest-environment jsdom

// 魔法注释, 指定 jsdom 环境
// pnpm test utils/is-browser.test.ts
import { describe, expect, it } from "vitest";

import isBrowser from "./is-browser.js";

describe("window globals in jsdom environment", () => {
  it("typeof window should be 'object' instead of 'undefined'", () => {
    expect(typeof window).not.toBe("undefined");
    expect(typeof window).toBe("object");
  });

  it("window.document should exist and be an object", () => {
    expect(window.document).toBeDefined();
    expect(typeof window.document).toBe("object");
  });

  it("window.document.createElement should be a function", () => {
    expect(window.document.createElement).toBeDefined();
    expect(typeof window.document.createElement).toBe("function");
    // Verify actual invocation
    const div = window.document.createElement("div");
    expect(div.tagName).toBe("DIV");
  });

  it("window.navigator should exist and contain userAgent", () => {
    expect(window.navigator).toBeDefined();
    expect(typeof window.navigator).toBe("object");
    expect(window.navigator.userAgent).toBeDefined();
    // jsdom userAgent includes 'jsdom' identifier
    expect(window.navigator.userAgent).toContain("jsdom");
  });

  it("isBrowser should be true in jsdom environment", () => {
    expect(isBrowser).toBe(true);
  });
});

describe("isBrowser condition breakdown", () => {
  it("all three conditions should be satisfied in jsdom", () => {
    const cond1 = typeof window !== "undefined";
    const cond2 = !!window.document;
    const cond3 = !!window.document?.createElement;
    expect(cond1).toBe(true);
    expect(cond2).toBe(true);
    expect(cond3).toBe(true);
  });
});
