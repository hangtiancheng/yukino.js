import { describe, it, expect } from "vitest";
import { crc32 } from "../src/crc32.js";

describe("crc32", () => {
  it("produces consistent hash for same input", () => {
    expect(crc32("hello")).toBe(crc32("hello"));
  });

  it("produces different hashes for different inputs", () => {
    expect(crc32("hello")).not.toBe(crc32("world"));
  });

  it("handles empty string", () => {
    const h = crc32("");
    expect(typeof h).toBe("number");
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it("accepts Buffer input", () => {
    const fromStr = crc32("test");
    const fromBuf = crc32(Buffer.from("test"));
    expect(fromStr).toBe(fromBuf);
  });

  it("returns unsigned 32-bit value", () => {
    const h = crc32("anything");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
