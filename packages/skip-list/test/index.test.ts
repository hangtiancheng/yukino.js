import { describe, expect, it } from "vitest";
import { SkipList, type Entry } from "../src/index.js";

function compare(a: Entry, b: Entry): number {
  if (a.score !== b.score) return a.score < b.score ? -1 : 1;
  if (a.member === b.member) return 0;
  return a.member < b.member ? -1 : 1;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seeded(seed = 42): SkipList {
  return new SkipList({ random: mulberry32(seed) });
}

function sliceByRank(entries: Entry[], start: number, stop: number): Entry[] {
  let from = start < 0 ? entries.length + start : start;
  let to = stop < 0 ? entries.length + stop : stop;
  if (from < 0) from = 0;
  if (to >= entries.length) to = entries.length - 1;
  return from > to ? [] : entries.slice(from, to + 1);
}

function filterByScore(
  entries: Entry[],
  min: number,
  max: number,
  minExclusive: boolean,
  maxExclusive: boolean,
): Entry[] {
  return entries.filter(
    (entry) =>
      (minExclusive ? entry.score > min : entry.score >= min) &&
      (maxExclusive ? entry.score < max : entry.score <= max),
  );
}

describe("SkipList", () => {
  describe("constructor", () => {
    it("should use default options", () => {
      const list = new SkipList();
      expect(list.length).toBe(0);
      expect(list.first()).toBeUndefined();
      expect(list.last()).toBeUndefined();
    });

    it("should accept custom maxLevel, probability, and random", () => {
      const list = new SkipList({
        maxLevel: 8,
        probability: 0.5,
        random: () => 0,
      });
      for (let i = 0; i < 100; i++) {
        list.add(`m${i}`, i);
      }
      expect(list.length).toBe(100);
      expect(list.toArray().map((entry) => entry.member)).toEqual(
        Array.from({ length: 100 }, (_, i) => `m${i}`),
      );
    });

    it.each([
      [0, "zero maxLevel"],
      [-1, "negative maxLevel"],
      [1.5, "non-integer maxLevel"],
      [NaN, "NaN maxLevel"],
      [Infinity, "Infinity maxLevel"],
      [65, "maxLevel above 64"],
    ])("should reject invalid maxLevel: %s", (maxLevel) => {
      expect(() => new SkipList({ maxLevel })).toThrow(RangeError);
    });

    it.each([
      [0, "zero probability"],
      [1, "probability of one"],
      [-0.1, "negative probability"],
      [1.5, "probability above one"],
      [NaN, "NaN probability"],
      [Infinity, "Infinity probability"],
    ])("should reject invalid probability: %s", (probability) => {
      expect(() => new SkipList({ probability })).toThrow(RangeError);
    });

    it("should reject a non-function random source", () => {
      expect(
        () => new SkipList({ random: 1 as unknown as () => number }),
      ).toThrow(TypeError);
    });
  });

  describe("add", () => {
    it("should insert new members and return true", () => {
      const list = new SkipList();
      expect(list.add("a", 1)).toBe(true);
      expect(list.add("b", 2)).toBe(true);
      expect(list.length).toBe(2);
      expect(list.has("a")).toBe(true);
      expect(list.has("b")).toBe(true);
    });

    it("should return false when the score is unchanged", () => {
      const list = new SkipList();
      list.add("a", 1);
      expect(list.add("a", 1)).toBe(false);
      expect(list.length).toBe(1);
    });

    it("should move a member when its score changes", () => {
      const list = new SkipList();
      list.add("a", 1);
      list.add("b", 2);
      list.add("c", 3);

      expect(list.add("a", 5)).toBe(true);
      expect(list.length).toBe(3);
      expect(list.score("a")).toBe(5);
      expect(list.toArray()).toEqual([
        { member: "b", score: 2 },
        { member: "c", score: 3 },
        { member: "a", score: 5 },
      ]);
    });

    it("should order by score and then by member", () => {
      const list = new SkipList();
      for (const member of ["c", "a", "d", "b"]) {
        list.add(member, 1);
      }
      list.add("z", 0);
      list.add("y", 2);

      expect(list.toArray().map((entry) => entry.member)).toEqual([
        "z",
        "a",
        "b",
        "c",
        "d",
        "y",
      ]);
    });

    it("should handle empty-string members", () => {
      const list = new SkipList();
      list.add("", 0);
      list.add("a", 0);
      expect(list.first()).toEqual({ member: "", score: 0 });
      expect(list.has("")).toBe(true);
    });

    it("should support infinite scores", () => {
      const list = new SkipList();
      list.add("finite", 0);
      list.add("max", Infinity);
      list.add("min", -Infinity);

      expect(list.toArray().map((entry) => entry.member)).toEqual([
        "min",
        "finite",
        "max",
      ]);
      expect(list.score("max")).toBe(Infinity);
    });

    it("should reject non-string members", () => {
      const list = new SkipList();
      expect(() => list.add(1 as unknown as string, 0)).toThrow(TypeError);
      expect(() => list.add(null as unknown as string, 0)).toThrow(TypeError);
      expect(() => list.add(undefined as unknown as string, 0)).toThrow(
        TypeError,
      );
    });

    it("should reject NaN and non-number scores", () => {
      const list = new SkipList();
      expect(() => list.add("a", NaN)).toThrow(RangeError);
      expect(() => list.add("a", "1" as unknown as number)).toThrow(RangeError);
      expect(() => list.add("a", undefined as unknown as number)).toThrow(
        RangeError,
      );
    });
  });

  describe("has & score", () => {
    it("should report membership and score", () => {
      const list = new SkipList();
      list.add("a", 3.5);

      expect(list.has("a")).toBe(true);
      expect(list.has("b")).toBe(false);
      expect(list.score("a")).toBe(3.5);
      expect(list.score("b")).toBeUndefined();
    });

    it("should validate members", () => {
      const list = new SkipList();
      expect(() => list.has(1 as unknown as string)).toThrow(TypeError);
      expect(() => list.score(1 as unknown as string)).toThrow(TypeError);
    });
  });

  describe("delete", () => {
    it("should remove members and return true", () => {
      const list = new SkipList();
      list.add("a", 1);
      list.add("b", 2);

      expect(list.delete("a")).toBe(true);
      expect(list.has("a")).toBe(false);
      expect(list.length).toBe(1);
      expect(list.toArray()).toEqual([{ member: "b", score: 2 }]);
    });

    it("should return false for missing members", () => {
      const list = new SkipList();
      expect(list.delete("missing")).toBe(false);
      expect(list.length).toBe(0);
    });

    it("should update first/last after deletions", () => {
      const list = new SkipList();
      list.add("a", 1);
      list.add("b", 2);
      list.add("c", 3);

      list.delete("a");
      expect(list.first()).toEqual({ member: "b", score: 2 });
      list.delete("c");
      expect(list.last()).toEqual({ member: "b", score: 2 });
      list.delete("b");
      expect(list.first()).toBeUndefined();
      expect(list.last()).toBeUndefined();
    });

    it("should support re-insertion after deletion", () => {
      const list = new SkipList();
      list.add("a", 1);
      list.delete("a");
      list.add("a", 9);
      expect(list.length).toBe(1);
      expect(list.score("a")).toBe(9);
    });

    it("should validate members", () => {
      const list = new SkipList();
      expect(() => list.delete(1 as unknown as string)).toThrow(TypeError);
    });
  });

  describe("rank & reverseRank", () => {
    it("should return zero-based ranks", () => {
      const list = new SkipList();
      ["a", "b", "c", "d"].forEach((member, i) => list.add(member, i));

      expect(list.rank("a")).toBe(0);
      expect(list.rank("b")).toBe(1);
      expect(list.rank("c")).toBe(2);
      expect(list.rank("d")).toBe(3);
      expect(list.reverseRank("a")).toBe(3);
      expect(list.reverseRank("d")).toBe(0);
    });

    it("should return -1 for missing members", () => {
      const list = new SkipList();
      expect(list.rank("missing")).toBe(-1);
      expect(list.reverseRank("missing")).toBe(-1);
    });

    it("should reflect score updates", () => {
      const list = new SkipList();
      list.add("a", 1);
      list.add("b", 2);
      list.add("c", 3);
      expect(list.rank("a")).toBe(0);

      list.add("a", 4);
      expect(list.rank("a")).toBe(2);
      expect(list.reverseRank("a")).toBe(0);
      expect(list.rank("b")).toBe(0);
    });

    it("should reflect deletions", () => {
      const list = new SkipList();
      list.add("a", 1);
      list.add("b", 2);
      list.add("c", 3);
      list.delete("a");

      expect(list.rank("b")).toBe(0);
      expect(list.rank("c")).toBe(1);
      expect(list.reverseRank("b")).toBe(1);
    });

    it("should order equal scores by member", () => {
      const list = new SkipList();
      ["c", "a", "b"].forEach((member) => list.add(member, 7));

      expect(list.rank("a")).toBe(0);
      expect(list.rank("b")).toBe(1);
      expect(list.rank("c")).toBe(2);
      expect(list.reverseRank("a")).toBe(2);
    });
  });

  describe("range", () => {
    function listOf(...scores: number[]): SkipList {
      const list = new SkipList();
      scores.forEach((score, i) => list.add(`m${i}`, score));
      return list;
    }

    it("should return an inclusive range", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.range(0, 2)).toEqual([
        { member: "m0", score: 1 },
        { member: "m1", score: 2 },
        { member: "m2", score: 3 },
      ]);
      expect(list.range(2, 4).map((entry) => entry.member)).toEqual([
        "m2",
        "m3",
        "m4",
      ]);
    });

    it("should support negative indices", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.range(-2, -1).map((entry) => entry.member)).toEqual([
        "m3",
        "m4",
      ]);
      expect(list.range(-100, 1).map((entry) => entry.member)).toEqual([
        "m0",
        "m1",
      ]);
    });

    it("should clamp out-of-bounds stops", () => {
      const list = listOf(1, 2, 3);
      expect(list.range(1, 100).map((entry) => entry.member)).toEqual([
        "m1",
        "m2",
      ]);
    });

    it("should return an empty array when start > stop", () => {
      const list = listOf(1, 2, 3);
      expect(list.range(2, 1)).toEqual([]);
      expect(list.range(10, 20)).toEqual([]);
    });

    it("should return an empty array for an empty list", () => {
      const list = new SkipList();
      expect(list.range(0, -1)).toEqual([]);
      expect(list.range(0, 0)).toEqual([]);
    });

    it("should reject non-integer bounds", () => {
      const list = listOf(1, 2, 3);
      expect(() => list.range(0.5, 1)).toThrow(RangeError);
      expect(() => list.range(0, NaN)).toThrow(RangeError);
      expect(() => list.range(0, Infinity)).toThrow(RangeError);
    });

    it("should handle a single element", () => {
      const list = listOf(42);
      expect(list.range(0, 0)).toEqual([{ member: "m0", score: 42 }]);
      expect(list.range(-1, -1)).toEqual([{ member: "m0", score: 42 }]);
    });
  });

  describe("reverseRange", () => {
    function listOf(...scores: number[]): SkipList {
      const list = new SkipList();
      scores.forEach((score, i) => list.add(`m${i}`, score));
      return list;
    }

    it("should return the full list in reverse order", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.reverseRange(0, -1).map((entry) => entry.member)).toEqual([
        "m4",
        "m3",
        "m2",
        "m1",
        "m0",
      ]);
    });

    it("should support positive and negative indices", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.reverseRange(1, 3).map((entry) => entry.member)).toEqual([
        "m3",
        "m2",
        "m1",
      ]);
      expect(list.reverseRange(-2, -1).map((entry) => entry.member)).toEqual([
        "m1",
        "m0",
      ]);
    });

    it("should return an empty array for invalid or empty ranges", () => {
      const list = listOf(1, 2, 3);
      expect(list.reverseRange(2, 1)).toEqual([]);
      expect(list.reverseRange(10, 20)).toEqual([]);
      expect(new SkipList().reverseRange(0, -1)).toEqual([]);
    });

    it("should reject non-integer bounds", () => {
      expect(() => listOf(1, 2, 3).reverseRange(0.5, 2)).toThrow(RangeError);
    });
  });

  describe("rangeByScore", () => {
    function listOf(...scores: number[]): SkipList {
      const list = new SkipList();
      scores.forEach((score, i) => list.add(`m${i}`, score));
      return list;
    }

    it("should include both bounds by default", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.rangeByScore(2, 4)).toEqual([
        { member: "m1", score: 2 },
        { member: "m2", score: 3 },
        { member: "m3", score: 4 },
      ]);
    });

    it("should support exclusive bounds", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(
        list.rangeByScore(2, 4, {
          minExclusive: true,
          maxExclusive: true,
        }),
      ).toEqual([{ member: "m2", score: 3 }]);
    });

    it("should support unbounded ranges", () => {
      const list = listOf(1, 2, 3);
      expect(list.rangeByScore(-Infinity, Infinity)).toHaveLength(3);
    });

    it("should return matches in reverse order when requested", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(
        list.rangeByScore(2, 4, { reverse: true }).map((entry) => entry.member),
      ).toEqual(["m3", "m2", "m1"]);
    });

    it("should handle duplicate scores across the boundary", () => {
      const list = new SkipList();
      ["c", "a", "b", "d"].forEach((member) => list.add(member, 5));

      expect(list.rangeByScore(5, 5).map((entry) => entry.member)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
      expect(
        list
          .rangeByScore(5, 5, { minExclusive: true })
          .map((entry) => entry.member),
      ).toEqual([]);
    });

    it("should return an empty array when nothing matches", () => {
      const list = listOf(1, 2, 3);
      expect(list.rangeByScore(10, 20)).toEqual([]);
      expect(list.rangeByScore(3, 2)).toEqual([]);
      expect(list.rangeByScore(1, 1, { minExclusive: true })).toEqual([]);
    });

    it("should work with infinite scores", () => {
      const list = new SkipList();
      list.add("min", -Infinity);
      list.add("mid", 0);
      list.add("max", Infinity);

      expect(list.rangeByScore(-Infinity, Infinity)).toHaveLength(3);
      expect(list.rangeByScore(Infinity, Infinity)).toEqual([
        { member: "max", score: Infinity },
      ]);
      expect(
        list
          .rangeByScore(-Infinity, Infinity, { reverse: true })
          .map((entry) => entry.member),
      ).toEqual(["max", "mid", "min"]);
    });

    it("should reject NaN bounds", () => {
      const list = listOf(1, 2, 3);
      expect(() => list.rangeByScore(NaN, 3)).toThrow(RangeError);
      expect(() => list.rangeByScore(1, NaN)).toThrow(RangeError);
    });
  });

  describe("count", () => {
    function listOf(...scores: number[]): SkipList {
      const list = new SkipList();
      scores.forEach((score, i) => list.add(`m${i}`, score));
      return list;
    }

    it("should count entries in an inclusive range", () => {
      const list = listOf(1, 2, 2, 3, 4);
      expect(list.count(2, 3)).toBe(3);
      expect(list.count(-Infinity, Infinity)).toBe(5);
    });

    it("should honor exclusive bounds", () => {
      const list = listOf(1, 2, 2, 3, 4);
      expect(list.count(2, 3, { minExclusive: true })).toBe(1);
      expect(list.count(2, 3, { minExclusive: true, maxExclusive: true })).toBe(
        0,
      );
      expect(list.count(1, 4, { maxExclusive: true })).toBe(4);
    });

    it("should return zero when nothing matches", () => {
      const list = listOf(1, 2, 3);
      expect(list.count(10, 20)).toBe(0);
      expect(list.count(3, 2)).toBe(0);
      expect(new SkipList().count(-Infinity, Infinity)).toBe(0);
    });

    it("should reject NaN bounds", () => {
      const list = listOf(1, 2, 3);
      expect(() => list.count(NaN, 3)).toThrow(RangeError);
    });
  });

  describe("removeRangeByRank", () => {
    function listOf(...scores: number[]): SkipList {
      const list = new SkipList();
      scores.forEach((score, i) => list.add(`m${i}`, score));
      return list;
    }

    it("should remove an inclusive rank range", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.removeRangeByRank(1, 3)).toBe(3);
      expect(list.toArray().map((entry) => entry.member)).toEqual(["m0", "m4"]);
      expect(list.length).toBe(2);
    });

    it("should support negative indices", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.removeRangeByRank(-2, -1)).toBe(2);
      expect(list.toArray().map((entry) => entry.member)).toEqual([
        "m0",
        "m1",
        "m2",
      ]);
    });

    it("should remove the whole list", () => {
      const list = listOf(1, 2, 3);
      expect(list.removeRangeByRank(0, -1)).toBe(3);
      expect(list.length).toBe(0);
      expect(list.first()).toBeUndefined();
      expect(list.last()).toBeUndefined();
    });

    it("should return zero for out-of-range requests", () => {
      const list = listOf(1, 2, 3);
      expect(list.removeRangeByRank(10, 20)).toBe(0);
      expect(list.removeRangeByRank(2, 1)).toBe(0);
      expect(list.length).toBe(3);
    });

    it("should reject non-integer bounds", () => {
      expect(() => listOf(1, 2, 3).removeRangeByRank(0.5, 1)).toThrow(
        RangeError,
      );
    });
  });

  describe("removeRangeByScore", () => {
    function listOf(...scores: number[]): SkipList {
      const list = new SkipList();
      scores.forEach((score, i) => list.add(`m${i}`, score));
      return list;
    }

    it("should remove entries in an inclusive score range", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(list.removeRangeByScore(2, 4)).toBe(3);
      expect(list.toArray()).toEqual([
        { member: "m0", score: 1 },
        { member: "m4", score: 5 },
      ]);
    });

    it("should honor exclusive bounds", () => {
      const list = listOf(1, 2, 3, 4, 5);
      expect(
        list.removeRangeByScore(2, 4, {
          minExclusive: true,
          maxExclusive: true,
        }),
      ).toBe(1);
      expect(list.toArray().map((entry) => entry.member)).toEqual([
        "m0",
        "m1",
        "m3",
        "m4",
      ]);
    });

    it("should return zero when nothing matches", () => {
      const list = listOf(1, 2, 3);
      expect(list.removeRangeByScore(10, 20)).toBe(0);
      expect(list.removeRangeByScore(3, 2)).toBe(0);
      expect(list.length).toBe(3);
    });

    it("should reject NaN bounds", () => {
      expect(() => listOf(1, 2, 3).removeRangeByScore(1, NaN)).toThrow(
        RangeError,
      );
    });
  });

  describe("popMin & popMax", () => {
    function listOf(...scores: number[]): SkipList {
      const list = new SkipList();
      scores.forEach((score, i) => list.add(`m${i}`, score));
      return list;
    }

    it("should pop the smallest entry by default", () => {
      const list = listOf(3, 1, 2);
      expect(list.popMin()).toEqual([{ member: "m1", score: 1 }]);
      expect(list.length).toBe(2);
    });

    it("should pop multiple entries in ascending order", () => {
      const list = listOf(3, 1, 2);
      expect(list.popMin(2)).toEqual([
        { member: "m1", score: 1 },
        { member: "m2", score: 2 },
      ]);
      expect(list.toArray()).toEqual([{ member: "m0", score: 3 }]);
    });

    it("should pop the largest entries in descending order", () => {
      const list = listOf(3, 1, 2);
      expect(list.popMax(2)).toEqual([
        { member: "m0", score: 3 },
        { member: "m2", score: 2 },
      ]);
      expect(list.toArray()).toEqual([{ member: "m1", score: 1 }]);
    });

    it("should stop at the end of the list", () => {
      const list = listOf(1, 2);
      expect(list.popMin(10)).toHaveLength(2);
      expect(list.length).toBe(0);
      expect(list.popMax(10)).toEqual([]);
      expect(list.popMin(10)).toEqual([]);
    });

    it("should return an empty array for count 0", () => {
      const list = listOf(1, 2);
      expect(list.popMin(0)).toEqual([]);
      expect(list.popMax(0)).toEqual([]);
      expect(list.length).toBe(2);
    });

    it.each([-1, 1.5, NaN, Infinity])(
      "should reject invalid count: %s",
      (count) => {
        const list = listOf(1, 2);
        expect(() => list.popMin(count)).toThrow(RangeError);
        expect(() => list.popMax(count)).toThrow(RangeError);
      },
    );
  });

  describe("iteration", () => {
    it("should iterate in ascending order", () => {
      const list = new SkipList();
      list.add("b", 2);
      list.add("a", 1);
      list.add("c", 3);

      expect([...list]).toEqual([
        { member: "a", score: 1 },
        { member: "b", score: 2 },
        { member: "c", score: 3 },
      ]);
      expect(list.toArray()).toEqual([...list.entries()]);
    });

    it("should iterate in descending order", () => {
      const list = new SkipList();
      [1, 2, 3].forEach((score) => list.add(`m${score}`, score));

      expect([...list.reverseEntries()].map((entry) => entry.member)).toEqual([
        "m3",
        "m2",
        "m1",
      ]);
    });

    it("should yield independent entry snapshots", () => {
      const list = new SkipList();
      list.add("a", 1);

      const entry = list.first();
      expect(entry).toEqual({ member: "a", score: 1 });
      (entry as { score: number }).score = 99;

      expect(list.first()).toEqual({ member: "a", score: 1 });
    });

    it("should allow early exit without mutating the list", () => {
      const list = new SkipList();
      [1, 2, 3].forEach((score) => list.add(`m${score}`, score));

      for (const entry of list) {
        expect(entry.member).toBe("m1");
        break;
      }
      expect(list.length).toBe(3);
    });
  });

  describe("clear", () => {
    it("should remove all entries and allow reuse", () => {
      const list = seeded();
      for (let i = 0; i < 100; i++) list.add(`m${i}`, i);
      list.clear();

      expect(list.length).toBe(0);
      expect(list.first()).toBeUndefined();
      expect(list.last()).toBeUndefined();
      expect(list.toArray()).toEqual([]);
      expect(list.rank("m1")).toBe(-1);
      expect(list.rangeByScore(-Infinity, Infinity)).toEqual([]);

      list.add("after", 1);
      expect(list.toArray()).toEqual([{ member: "after", score: 1 }]);
    });
  });

  describe("level generation", () => {
    it("should work when every node reaches maxLevel", () => {
      const list = new SkipList({
        maxLevel: 6,
        probability: 0.5,
        random: () => 0,
      });
      for (let i = 0; i < 1_000; i++) {
        list.add(`m${i}`, i);
      }

      expect(list.length).toBe(1_000);
      expect(list.rank("m999")).toBe(999);
      expect(list.range(500, 505).map((entry) => entry.member)).toEqual([
        "m500",
        "m501",
        "m502",
        "m503",
        "m504",
        "m505",
      ]);
    });

    it("should work when every node stays at level one", () => {
      const list = new SkipList({
        maxLevel: 32,
        probability: 0.25,
        random: () => 0.999,
      });
      for (let i = 0; i < 1_000; i++) {
        list.add(`m${i}`, i);
      }

      expect(list.length).toBe(1_000);
      expect(list.rank("m0")).toBe(0);
      expect(list.rank("m999")).toBe(999);
      expect(list.reverseRange(0, 2).map((entry) => entry.member)).toEqual([
        "m999",
        "m998",
        "m997",
      ]);
    });

    it("should produce identical results with the same seed", () => {
      function snapshot(): Entry[] {
        const list = seeded(7);
        const random = mulberry32(99);
        for (let i = 0; i < 500; i++) {
          const member = `m${Math.floor(random() * 200)}`;
          list.add(member, Math.floor(random() * 50));
          if (random() < 0.2) list.delete(`m${Math.floor(random() * 200)}`);
        }
        return list.toArray();
      }

      expect(snapshot()).toEqual(snapshot());
    });
  });

  describe("randomized model comparison", () => {
    it("should match a sorted array model", () => {
      const random = mulberry32(1234);
      const list = new SkipList({ random: mulberry32(5678) });
      const model = new Map<string, number>();

      const expected = (): Entry[] =>
        [...model.entries()]
          .map(([member, score]) => ({ member, score }))
          .sort(compare);

      for (let step = 0; step < 2_000; step++) {
        const member = `m${Math.floor(random() * 120)}`;
        const score = Math.floor(random() * 30) - 15;
        const operation = random();

        if (operation < 0.65) {
          const isNew = !model.has(member);
          const changed = model.get(member) !== score;
          model.set(member, score);
          expect(list.add(member, score)).toBe(isNew || changed);
        } else if (operation < 0.9) {
          expect(list.delete(member)).toBe(model.delete(member));
        } else {
          expect(list.has(member)).toBe(model.has(member));
          expect(list.score(member)).toBe(model.get(member));
        }

        if (step % 25 === 0) {
          const sorted = expected();
          expect(list.toArray()).toEqual(sorted);
          expect(list.length).toBe(sorted.length);
          if (sorted.length > 0) {
            expect(list.first()).toEqual(sorted[0]);
            expect(list.last()).toEqual(sorted[sorted.length - 1]);
          }
        }
      }

      const sorted = expected();
      expect(list.toArray()).toEqual(sorted);

      for (let i = 0; i < sorted.length; i += 10) {
        const entry = sorted[i];
        expect(list.rank(entry.member)).toBe(i);
        expect(list.reverseRank(entry.member)).toBe(sorted.length - 1 - i);
        expect(list.range(i, i)).toEqual([entry]);
      }

      expect(list.range(0, -1)).toEqual(sorted);
      expect(list.reverseRange(0, -1)).toEqual([...sorted].reverse());

      for (let probe = 0; probe < 30; probe++) {
        const min = Math.floor(random() * 40) - 20;
        const max = min + Math.floor(random() * 10);
        const minExclusive = random() < 0.5;
        const maxExclusive = random() < 0.5;
        const options = { minExclusive, maxExclusive };
        const filtered = filterByScore(
          sorted,
          min,
          max,
          minExclusive,
          maxExclusive,
        );

        expect(list.rangeByScore(min, max, options)).toEqual(filtered);
        expect(
          list.rangeByScore(min, max, { ...options, reverse: true }),
        ).toEqual([...filtered].reverse());
        expect(list.count(min, max, options)).toBe(filtered.length);

        const start = Math.floor(random() * 20) - 10;
        const stop = start + Math.floor(random() * 10);
        expect(list.range(start, stop)).toEqual(
          sliceByRank(sorted, start, stop),
        );
        expect(list.reverseRange(start, stop)).toEqual(
          sliceByRank([...sorted].reverse(), start, stop),
        );
      }
    });

    it("should match a sorted array model for bulk removals", () => {
      const random = mulberry32(31415);

      for (let round = 0; round < 200; round++) {
        const list = seeded(round + 1);
        const model = new Map<string, number>();

        for (let i = 0; i < 80; i++) {
          model.set(
            `m${Math.floor(random() * 150)}`,
            Math.floor(random() * 25) - 12,
          );
        }
        for (const [member, score] of model) {
          list.add(member, score);
        }

        let sorted = [...model.entries()]
          .map(([member, score]) => ({ member, score }))
          .sort(compare);

        if (random() < 0.5) {
          const min = Math.floor(random() * 30) - 15;
          const max = min + Math.floor(random() * 12);
          const minExclusive = random() < 0.5;
          const maxExclusive = random() < 0.5;
          const removed = filterByScore(
            sorted,
            min,
            max,
            minExclusive,
            maxExclusive,
          );
          const removedKeys = new Set(removed.map((entry) => entry.member));

          expect(
            list.removeRangeByScore(min, max, {
              minExclusive,
              maxExclusive,
            }),
          ).toBe(removed.length);
          sorted = sorted.filter((entry) => !removedKeys.has(entry.member));
        } else {
          const start = Math.floor(random() * 20) - 10;
          const stop = start + Math.floor(random() * 12);
          const removed = sliceByRank(sorted, start, stop);
          const removedKeys = new Set(removed.map((entry) => entry.member));

          expect(list.removeRangeByRank(start, stop)).toBe(removed.length);
          sorted = sorted.filter((entry) => !removedKeys.has(entry.member));
        }

        expect(list.toArray()).toEqual(sorted);
        expect(list.length).toBe(sorted.length);
        if (sorted.length > 0) {
          expect(list.first()).toEqual(sorted[0]);
          expect(list.last()).toEqual(sorted[sorted.length - 1]);
          expect(list.rank(sorted[0].member)).toBe(0);
          expect(list.rank(sorted[sorted.length - 1].member)).toBe(
            sorted.length - 1,
          );
        }
      }
    });
  });

  describe("large scale", () => {
    it("should handle 50k ordered insertions", () => {
      const n = 50_000;
      const list = seeded(11);
      for (let i = 0; i < n; i++) {
        list.add(`m${i}`, i);
      }

      expect(list.length).toBe(n);
      expect(list.first()).toEqual({ member: "m0", score: 0 });
      expect(list.last()).toEqual({ member: `m${n - 1}`, score: n - 1 });
      expect(list.rank("m0")).toBe(0);
      expect(list.rank(`m${n / 2}`)).toBe(n / 2);
      expect(list.rank(`m${n - 1}`)).toBe(n - 1);
      expect(list.range(0, 2).map((entry) => entry.member)).toEqual([
        "m0",
        "m1",
        "m2",
      ]);
      expect(list.rangeByScore(100, 199)).toHaveLength(100);
      expect(list.count(0, n - 1)).toBe(n);
      expect(list.reverseRange(0, 1).map((entry) => entry.member)).toEqual([
        `m${n - 1}`,
        `m${n - 2}`,
      ]);
    });

    it("should handle bulk deletions across the whole list", () => {
      const n = 20_000;
      const list = seeded(13);
      for (let i = 0; i < n; i++) {
        list.add(`m${i}`, i);
      }

      expect(list.removeRangeByScore(5_000, 14_999)).toBe(10_000);
      expect(list.length).toBe(10_000);
      expect(list.rank("m5000")).toBe(-1);
      expect(list.rank("m4999")).toBe(4_999);
      expect(list.rank("m15000")).toBe(5_000);

      expect(list.removeRangeByRank(0, 4_999)).toBe(5_000);
      expect(list.length).toBe(5_000);
      expect(list.first()).toEqual({ member: "m15000", score: 15_000 });
      expect(list.last()).toEqual({ member: `m${n - 1}`, score: n - 1 });
    });
  });
});
