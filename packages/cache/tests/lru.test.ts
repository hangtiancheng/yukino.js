import { describe, it, expect, afterEach } from "vitest";
import { LruStore, hashBKRD, maskOfNextPowOf2 } from "../src/lru.js";
import { Value } from "../src/store.js";

class TestValue implements Value {
  constructor(public s: string) {}
  len(): number {
    return this.s.length;
  }
}

function tv(s: string): TestValue {
  return new TestValue(s);
}

describe("hashBKRD", () => {
  it("returns different hashes for different keys", () => {
    expect(hashBKRD("key")).not.toBe(hashBKRD("other"));
  });

  it("returns consistent hash", () => {
    expect(hashBKRD("key")).toBe(hashBKRD("key"));
  });
});

describe("maskOfNextPowOf2", () => {
  it("computes correct masks", () => {
    expect(maskOfNextPowOf2(1)).toBe(0);
    expect(maskOfNextPowOf2(2)).toBe(1);
    expect(maskOfNextPowOf2(3)).toBe(3);
    expect(maskOfNextPowOf2(4)).toBe(3);
    expect(maskOfNextPowOf2(8)).toBe(7);
    expect(maskOfNextPowOf2(16)).toBe(15);
  });
});

describe("LruStore basic operations", () => {
  let store: LruStore;

  afterEach(() => {
    store?.close();
  });

  it("returns miss for unknown key", () => {
    store = new LruStore({
      bucketCount: 1,
      capPerBucket: 2,
      level2Cap: 2,
      cleanupInterval: 0,
    });
    const [val, ok] = store.get("missing");
    expect(ok).toBe(false);
    expect(val).toBeNull();
  });

  it("set and get values", () => {
    store = new LruStore({
      bucketCount: 1,
      capPerBucket: 2,
      level2Cap: 2,
      cleanupInterval: 0,
    });
    store.set("a", tv("alpha"));
    store.set("b", tv("beta"));

    const [va, oka] = store.get("a");
    expect(oka).toBe(true);
    expect((va as TestValue).s).toBe("alpha");

    const [vb, okb] = store.get("b");
    expect(okb).toBe(true);
    expect((vb as TestValue).s).toBe("beta");
  });

  it("delete existing key returns true", () => {
    store = new LruStore({
      bucketCount: 1,
      capPerBucket: 2,
      level2Cap: 2,
      cleanupInterval: 0,
    });
    store.set("a", tv("alpha"));
    expect(store.delete("a")).toBe(true);
    expect(store.delete("missing")).toBe(false);
  });

  it("clear empties the store", () => {
    store = new LruStore({
      bucketCount: 1,
      capPerBucket: 4,
      level2Cap: 4,
      cleanupInterval: 0,
    });
    store.set("a", tv("alpha"));
    store.set("b", tv("beta"));
    store.clear();
    expect(store.len()).toBe(0);
  });

  it("update existing key", () => {
    store = new LruStore({
      bucketCount: 1,
      capPerBucket: 2,
      level2Cap: 2,
      cleanupInterval: 0,
    });
    store.set("a", tv("alpha"));
    store.set("a", tv("updated"));
    const [va, ok] = store.get("a");
    expect(ok).toBe(true);
    expect((va as TestValue).s).toBe("updated");
  });
});

describe("LruStore capacity eviction", () => {
  it("evicts oldest key when bucket overflows", () => {
    const evicted: string[] = [];
    const store = new LruStore({
      bucketCount: 1,
      capPerBucket: 2,
      level2Cap: 2,
      cleanupInterval: 0,
      onEvicted: (key) => evicted.push(key),
    });

    store.set("a", tv("alpha"));
    store.set("b", tv("beta"));
    store.set("c", tv("gamma"));

    const [, okA] = store.get("a");
    expect(okA).toBe(false);

    const [vb, okB] = store.get("b");
    expect(okB).toBe(true);
    expect((vb as TestValue).s).toBe("beta");

    const [vc, okC] = store.get("c");
    expect(okC).toBe(true);
    expect((vc as TestValue).s).toBe("gamma");

    expect(evicted).toContain("a");
    store.close();
  });
});

describe("LruStore promotion and eviction", () => {
  it("promotes L1 to L2 on get, keeping them across L1 overflow", () => {
    const store = new LruStore({
      bucketCount: 1,
      capPerBucket: 2,
      level2Cap: 2,
      cleanupInterval: 0,
    });

    store.set("a", tv("value-a"));
    store.set("b", tv("value-b"));
    store.get("a");
    store.get("b");

    store.set("c", tv("value-c"));
    store.set("d", tv("value-d"));

    const [va, okA] = store.get("a");
    expect(okA).toBe(true);
    expect((va as TestValue).s).toBe("value-a");

    const [vc, okC] = store.get("c");
    expect(okC).toBe(true);
    expect((vc as TestValue).s).toBe("value-c");

    store.close();
  });
});

describe("LruStore expiration", () => {
  it("expires keys after TTL", async () => {
    const store = new LruStore({
      bucketCount: 1,
      capPerBucket: 8,
      level2Cap: 8,
      cleanupInterval: 50,
    });

    store.setWithExpiration("short", tv("value"), 150);
    const [v, ok] = store.get("short");
    expect(ok).toBe(true);
    expect((v as TestValue).s).toBe("value");

    await new Promise((r) => setTimeout(r, 400));

    const [, ok2] = store.get("short");
    expect(ok2).toBe(false);

    store.close();
  });

  it("non-expiring key persists through cleanup cycles", async () => {
    const store = new LruStore({
      bucketCount: 1,
      capPerBucket: 4,
      level2Cap: 4,
      cleanupInterval: 50,
    });

    store.set("permanent", tv("value"));
    await new Promise((r) => setTimeout(r, 200));

    const [v, ok] = store.get("permanent");
    expect(ok).toBe(true);
    expect((v as TestValue).s).toBe("value");

    store.close();
  });

  it("mixed expiration: short expires, long persists", async () => {
    const store = new LruStore({
      bucketCount: 2,
      capPerBucket: 4,
      level2Cap: 4,
      cleanupInterval: 50,
    });

    store.setWithExpiration("soon", tv("value"), 150);
    store.setWithExpiration("later", tv("value"), 3_600_000);

    const [, okSoon] = store.get("soon");
    expect(okSoon).toBe(true);

    await new Promise((r) => setTimeout(r, 400));

    const [, okSoon2] = store.get("soon");
    expect(okSoon2).toBe(false);

    const [, okLater] = store.get("later");
    expect(okLater).toBe(true);

    store.close();
  });

  it("close is idempotent", () => {
    const store = new LruStore({
      bucketCount: 1,
      capPerBucket: 4,
      level2Cap: 4,
      cleanupInterval: 50,
    });
    store.close();
    store.close();
  });
});

describe("LruStore onEvicted callback on delete", () => {
  it("fires on delete", () => {
    const evicted: string[] = [];
    const store = new LruStore({
      bucketCount: 1,
      capPerBucket: 4,
      level2Cap: 4,
      cleanupInterval: 0,
      onEvicted: (key) => evicted.push(key),
    });

    store.set("a", tv("alpha"));
    store.delete("a");
    expect(evicted).toContain("a");
    store.close();
  });
});
