import { describe, it, expect } from "vitest";
import { ByteView, cloneBytes } from "../src/byte-view.js";

describe("ByteView", () => {
  it("returns correct length", () => {
    const view = new ByteView(Buffer.from("hello"));
    expect(view.len()).toBe(5);
  });

  it("returns string representation", () => {
    const view = new ByteView(Buffer.from("value"));
    expect(view.toString()).toBe("value");
  });

  it("byteSlice returns a copy that does not affect original", () => {
    const view = new ByteView(Buffer.from("value"));
    const copy = view.byteSlice();
    copy[0] = 0x58;
    expect(view.toString()).toBe("value");
  });

  it("multiple byteSlice calls return independent copies", () => {
    const view = new ByteView(Buffer.from("value"));
    const c1 = view.byteSlice();
    const c2 = view.byteSlice();
    c1[0] = 0x58;
    c2[0] = 0x59;
    expect(view.toString()).toBe("value");
  });

  it("handles empty buffer", () => {
    const view = new ByteView(Buffer.alloc(0));
    expect(view.len()).toBe(0);
    expect(view.toString()).toBe("");
    expect(view.byteSlice().length).toBe(0);
  });
});

describe("cloneBytes", () => {
  it("returns an independent copy", () => {
    const original = Buffer.from("hello");
    const clone = cloneBytes(original);
    clone[0] = 0x58;
    expect(original.toString()).toBe("hello");
    expect(clone.toString()).toBe("Xello");
  });

  it("preserves length", () => {
    const original = Buffer.from([1, 2, 3]);
    const clone = cloneBytes(original);
    expect(clone.length).toBe(3);
  });
});
