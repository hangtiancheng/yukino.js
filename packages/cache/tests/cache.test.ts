import { describe, it, expect } from "vitest";
import { Cache } from "../src/cache.js";
import { ByteView } from "../src/byte-view.js";

describe("Cache", () => {
  it("returns miss on empty cache", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    const [, ok] = cache.get("missing");
    expect(ok).toBe(false);
    cache.close();
  });

  it("add and get value", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    cache.add("key", new ByteView(Buffer.from("value")));
    const [view, ok] = cache.get("key");
    expect(ok).toBe(true);
    expect(view!.toString()).toBe("value");
    cache.close();
  });

  it("rejects already-expired values in addWithExpiration", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    cache.addWithExpiration(
      "expired",
      new ByteView(Buffer.from("value")),
      Date.now() - 1000,
    );
    const [, ok] = cache.get("expired");
    expect(ok).toBe(false);
    cache.close();
  });

  it("tracks hits and misses in stats", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    cache.add("key", new ByteView(Buffer.from("value")));
    cache.get("key");
    cache.get("missing");

    const stats = cache.stats();
    expect(stats["hits"]).toBe(1);
    expect(stats["misses"] as number).toBeGreaterThanOrEqual(1);
    cache.close();
  });

  it("delete removes key", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    cache.add("key", new ByteView(Buffer.from("value")));
    expect(cache.delete("key")).toBe(true);
    const [, ok] = cache.get("key");
    expect(ok).toBe(false);
    cache.close();
  });

  it("close makes cache reject adds", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    cache.close();
    cache.close();
    cache.add("closed", new ByteView(Buffer.from("value")));
    expect(cache.len()).toBe(0);
  });

  it("clear resets cache", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    cache.add("a", new ByteView(Buffer.from("alpha")));
    cache.add("b", new ByteView(Buffer.from("beta")));
    cache.clear();
    expect(cache.len()).toBe(0);
    cache.close();
  });

  it("lazy initialization only happens on first write", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    const stats1 = cache.stats();
    expect(stats1["initialized"]).toBe(false);

    cache.add("key", new ByteView(Buffer.from("val")));
    const stats2 = cache.stats();
    expect(stats2["initialized"]).toBe(true);
    cache.close();
  });

  it("stats include hit rate", () => {
    const cache = new Cache({ maxBytes: 128, cleanupTime: 3_600_000 });
    cache.add("key", new ByteView(Buffer.from("val")));
    cache.get("key");
    cache.get("miss");

    const stats = cache.stats();
    expect(stats["hit_rate"]).toBeCloseTo(0.5, 1);
    cache.close();
  });
});
