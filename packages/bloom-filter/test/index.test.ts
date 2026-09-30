import { describe, it, expect } from "vitest";
import { BloomFilter } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bulkAdd(filter: BloomFilter, count: number, prefix: string): void {
  for (let i = 0; i < count; i++) {
    filter.add(`${prefix}_${i}`);
  }
}

function countFalsePositives(
  filter: BloomFilter,
  count: number,
  prefix: string,
): number {
  let fp = 0;
  for (let i = 0; i < count; i++) {
    if (filter.has(`${prefix}_${i}`)) fp++;
  }
  return fp;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("BloomFilter", () => {
  // -----------------------------------------------------------------------
  // Construction & validation
  // -----------------------------------------------------------------------

  describe("constructor", () => {
    it("should compute valid m and k for typical parameters", () => {
      const bf = new BloomFilter(1000, 0.01);
      expect(bf.m).toBeGreaterThan(0);
      expect(bf.k).toBeGreaterThanOrEqual(1);
    });

    it("should accept a custom seed", () => {
      const bf = new BloomFilter(100, 0.01, 42);
      expect(bf.getConfig().seed).toBe(42);
    });

    it("should work with expectedItems = 1", () => {
      const bf = new BloomFilter(1, 0.01);
      bf.add("only");
      expect(bf.has("only")).toBe(true);
    });

    it.each([
      [0, 0.01, "zero expectedItems"],
      [-1, 0.01, "negative expectedItems"],
      [NaN, 0.01, "NaN expectedItems"],
      [Infinity, 0.01, "Infinity expectedItems"],
      [100.5, 0.01, "non-integer expectedItems"],
      [100, 0, "zero falsePositiveRate"],
      [100, 1, "falsePositiveRate = 1"],
      [100, 1.5, "falsePositiveRate > 1"],
      [100, -0.01, "negative falsePositiveRate"],
      [100, NaN, "NaN falsePositiveRate"],
      [100, Infinity, "Infinity falsePositiveRate"],
    ])("should throw for invalid params: %s", (n, p) => {
      expect(() => new BloomFilter(n, p)).toThrow(RangeError);
    });

    it.each([
      [NaN, "NaN seed"],
      [-1, "negative seed"],
      [1.5, "non-integer seed"],
      [2 ** 32, "seed exceeding 32-bit range"],
      [Infinity, "Infinity seed"],
    ])("should throw for invalid seed: %s", (seed) => {
      expect(() => new BloomFilter(100, 0.01, seed)).toThrow(RangeError);
    });

    it("should throw when computed m exceeds 2^32", () => {
      // n=1e9, p=1e-15 produces an extremely large m
      expect(() => new BloomFilter(1_000_000_000, 1e-15)).toThrow(RangeError);
    });
  });

  // -----------------------------------------------------------------------
  // Core: add / has
  // -----------------------------------------------------------------------

  describe("add & has", () => {
    it("should return true for all inserted items (zero false negatives)", () => {
      const bf = new BloomFilter(1000, 0.01);

      bf.add("hello");
      bf.add("world");
      bf.add(123);
      bf.add(true);
      bf.add(false);
      bf.add(0);
      bf.add("");

      expect(bf.has("hello")).toBe(true);
      expect(bf.has("world")).toBe(true);
      expect(bf.has(123)).toBe(true);
      expect(bf.has(true)).toBe(true);
      expect(bf.has(false)).toBe(true);
      expect(bf.has(0)).toBe(true);
      expect(bf.has("")).toBe(true);
    });

    it("should return false for items never inserted", () => {
      const bf = new BloomFilter(1000, 0.01);
      bf.add("alpha");

      expect(bf.has("beta")).toBe(false);
      expect(bf.has("gamma")).toBe(false);
      expect(bf.has(999)).toBe(false);
    });

    it("should distinguish between types (no cross-type collision)", () => {
      const bf = new BloomFilter(1000, 0.01);
      bf.add(0);

      expect(bf.has(0)).toBe(true);
      expect(bf.has("0")).toBe(false);
      expect(bf.has(false)).toBe(false);
    });

    it("should distinguish boolean false from string 'false'", () => {
      const bf = new BloomFilter(1000, 0.01);
      bf.add(false);

      expect(bf.has(false)).toBe(true);
      expect(bf.has("false")).toBe(false);
    });

    it("add should return this for chaining", () => {
      const bf = new BloomFilter(100, 0.01);
      const ret = bf.add("a").add("b").add("c");
      expect(ret).toBe(bf);
      expect(bf.has("a")).toBe(true);
      expect(bf.has("c")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // addAll
  // -----------------------------------------------------------------------

  describe("addAll", () => {
    it("should add items from an iterable", () => {
      const bf = new BloomFilter(100, 0.01);
      bf.addAll(["x", "y", "z", 1, 2, true]);

      expect(bf.has("x")).toBe(true);
      expect(bf.has("z")).toBe(true);
      expect(bf.has(2)).toBe(true);
      expect(bf.has(true)).toBe(true);
    });

    it("should accept a generator", () => {
      const bf = new BloomFilter(100, 0.01);
      function* gen() {
        yield "gen_a";
        yield "gen_b";
      }
      bf.addAll(gen());

      expect(bf.has("gen_a")).toBe(true);
      expect(bf.has("gen_b")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  describe("clear", () => {
    it("should reset the filter so all has() return false", () => {
      const bf = new BloomFilter(100, 0.01);
      bulkAdd(bf, 50, "item");

      expect(bf.has("item_0")).toBe(true);
      expect(bf.size).toBe(50);

      bf.clear();

      expect(bf.has("item_0")).toBe(false);
      expect(bf.has("item_49")).toBe(false);
      expect(bf.size).toBe(0);
      expect(bf.fillRatio).toBe(0);
    });

    it("should allow re-use after clear", () => {
      const bf = new BloomFilter(100, 0.01);
      bf.add("before");
      bf.clear();
      bf.add("after");

      expect(bf.has("before")).toBe(false);
      expect(bf.has("after")).toBe(true);
      expect(bf.size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Set operations
  // -----------------------------------------------------------------------

  describe("union", () => {
    it("should produce a filter containing items from both operands", () => {
      const a = new BloomFilter(100, 0.01, 7);
      const b = new BloomFilter(100, 0.01, 7);

      a.add("only_a");
      b.add("only_b");

      const merged = a.union(b);
      expect(merged.has("only_a")).toBe(true);
      expect(merged.has("only_b")).toBe(true);
    });

    it("should not mutate the original filters", () => {
      const a = new BloomFilter(100, 0.01, 7);
      const b = new BloomFilter(100, 0.01, 7);

      a.add("item_a");
      b.add("item_b");

      a.union(b);
      expect(a.has("item_b")).toBe(false);
    });

    it("should throw for incompatible filters", () => {
      const a = new BloomFilter(100, 0.01, 0);
      const b = new BloomFilter(200, 0.01, 0);

      expect(() => a.union(b)).toThrow(/Incompatible/);
    });
  });

  describe("clone", () => {
    it("should produce an independent copy", () => {
      const original = new BloomFilter(100, 0.01);
      original.add("x");

      const copy = original.clone();
      copy.add("y");

      expect(copy.has("x")).toBe(true);
      expect(copy.has("y")).toBe(true);
      expect(original.has("y")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Diagnostics
  // -----------------------------------------------------------------------

  describe("diagnostics", () => {
    it("size should count add() calls (including duplicates)", () => {
      const bf = new BloomFilter(100, 0.01);
      expect(bf.size).toBe(0);
      bf.add("a");
      bf.add("a");
      expect(bf.size).toBe(2);
    });

    it("fillRatio should be 0 for empty and increase after inserts", () => {
      const bf = new BloomFilter(100, 0.01);
      expect(bf.fillRatio).toBe(0);

      bulkAdd(bf, 100, "item");
      expect(bf.fillRatio).toBeGreaterThan(0);
      expect(bf.fillRatio).toBeLessThanOrEqual(1);
    });

    it("isSaturated should be false when lightly loaded", () => {
      const bf = new BloomFilter(1000, 0.01);
      bulkAdd(bf, 100, "item");
      expect(bf.isSaturated).toBe(false);
    });

    it("estimatedItemCount should approximate distinct inserts", () => {
      const bf = new BloomFilter(1000, 0.01);
      bulkAdd(bf, 500, "est");

      const estimate = bf.estimatedItemCount;
      // Allow 20% tolerance for probabilistic estimation
      expect(estimate).toBeGreaterThan(400);
      expect(estimate).toBeLessThan(600);
    });

    it("estimatedItemCount should be 0 for empty filter", () => {
      const bf = new BloomFilter(100, 0.01);
      expect(bf.estimatedItemCount).toBe(0);
    });

    it("getConfig should return full construction parameters", () => {
      const bf = new BloomFilter(500, 0.05, 7);
      const cfg = bf.getConfig();

      expect(cfg.expectedItems).toBe(500);
      expect(cfg.falsePositiveRate).toBe(0.05);
      expect(cfg.seed).toBe(7);
      expect(cfg.m).toBe(bf.m);
      expect(cfg.k).toBe(bf.k);
    });
  });

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  describe("serialize / deserialize", () => {
    it("should round-trip without data loss", () => {
      const bf = new BloomFilter(500, 0.01, 42);
      bulkAdd(bf, 200, "ser");

      const snapshot = bf.serialize();
      const restored = BloomFilter.deserialize(snapshot);

      for (let i = 0; i < 200; i++) {
        expect(restored.has(`ser_${i}`)).toBe(true);
      }
      expect(restored.getConfig()).toEqual(bf.getConfig());
      expect(restored.size).toBe(200);
    });

    it("should produce valid JSON", () => {
      const bf = new BloomFilter(100, 0.01);
      bf.add("json_test");

      const json = JSON.stringify(bf.serialize());
      const parsed = JSON.parse(json);
      const restored = BloomFilter.deserialize(parsed);

      expect(restored.has("json_test")).toBe(true);
      expect(restored.size).toBe(1);
    });

    it("should reject a corrupted snapshot (wrong data length)", () => {
      const bf = new BloomFilter(100, 0.01);
      const snapshot = bf.serialize();
      snapshot.data = Buffer.from([0, 1, 2]).toString("base64");

      expect(() => BloomFilter.deserialize(snapshot)).toThrow(
        /length mismatch/,
      );
    });

    it("should reject a tampered config (m/k mismatch)", () => {
      const bf = new BloomFilter(100, 0.01);
      const snapshot = bf.serialize();
      snapshot.config = { ...snapshot.config, m: 999 };

      expect(() => BloomFilter.deserialize(snapshot)).toThrow(
        /config mismatch/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Determinism & seed
  // -----------------------------------------------------------------------

  describe("determinism", () => {
    it("same seed should produce identical bit arrays", () => {
      const a = new BloomFilter(100, 0.01, 99);
      const b = new BloomFilter(100, 0.01, 99);

      const items = ["foo", "bar", "baz"];
      for (const x of items) {
        a.add(x);
        b.add(x);
      }

      expect(a.serialize().data).toBe(b.serialize().data);
    });

    it("different seeds should produce different bit arrays", () => {
      const a = new BloomFilter(100, 0.01, 0);
      const b = new BloomFilter(100, 0.01, 12345);

      a.add("same_item");
      b.add("same_item");

      expect(a.serialize().data).not.toBe(b.serialize().data);
    });
  });

  // -----------------------------------------------------------------------
  // False-positive rate
  // -----------------------------------------------------------------------

  describe("false-positive rate", () => {
    it.each([
      [1_000, 0.01],
      [1_000, 0.05],
      [5_000, 0.001],
    ])(
      "n=%i, p=%f -> actual FP rate should stay below 2x target",
      (n, targetP) => {
        const bf = new BloomFilter(n, targetP);
        bulkAdd(bf, n, "in");

        // Zero false negatives
        for (let i = 0; i < n; i++) {
          expect(bf.has(`in_${i}`)).toBe(true);
        }

        // Measure false-positive rate on a disjoint set
        const probeCount = 50_000;
        const fp = countFalsePositives(bf, probeCount, "out");
        const actualRate = fp / probeCount;

        expect(actualRate).toBeLessThan(targetP * 2);
      },
    );
  });

  // -----------------------------------------------------------------------
  // Large-scale smoke test
  // -----------------------------------------------------------------------

  describe("large scale", () => {
    it("should handle 100k items without degradation", () => {
      const n = 100_000;
      const bf = new BloomFilter(n, 0.01);
      bulkAdd(bf, n, "lg");

      // Spot-check: no false negatives (sampled every 1000th)
      for (let i = 0; i < n; i += 1_000) {
        expect(bf.has(`lg_${i}`)).toBe(true);
      }

      expect(bf.size).toBe(n);
      expect(bf.fillRatio).toBeLessThan(0.8);
    });
  });
});
