import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkipList,
  compareOrdered,
  dump,
  load,
  dumpFile,
  loadFile,
  stringCodec,
  intCodec,
  int64Codec,
  uint64Codec,
  float64Codec,
  bytesCodec,
  ParseError,
  MAX_RECORD_SIZE,
} from "../src/index.js";

function random(seed = 42): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const format = { key: stringCodec, value: stringCodec };
describe("generic skiplist", () => {
  it("matches Go insert/set/delete and handles stored undefined", () => {
    const list = new SkipList<number, string | undefined>();
    expect(list.level).toBe(0);
    expect(list.insert(2, "two")).toBe(true);
    expect(list.insert(2, "ignored")).toBe(false);
    expect(list.set(2, undefined)).toEqual(["two", true]);
    expect(list.has(2)).toBe(true);
    expect(list.get(2)).toBeUndefined();
    expect(list.set(3, "three")).toEqual([undefined, false]);
    expect(list.delete(2)).toEqual([undefined, true]);
    expect(list.delete(2)).toEqual([undefined, false]);
    list.clear();
    expect(list.level).toBe(0);
    expect(list.length).toBe(0);
    expect(list.min()).toBeUndefined();
    expect(list.max()).toBeUndefined();
    list.insert(1, "one");
    expect(list.min()).toEqual({ key: 1, value: "one" });
  });
  it("uses comparator equality while keeping the original key", () => {
    const list = new SkipList<{ id: number }, string>({
      compare: (a, b) => b.id - a.id,
    });
    const key = { id: 3 };
    list.insert(key, "three");
    list.insert({ id: 1 }, "one");
    list.insert({ id: 2 }, "two");
    expect(list.set({ id: 3 }, "III")).toEqual(["three", true]);
    expect(list.min()!.key).toBe(key);
    expect([...list.range({ id: 3 }, { id: 1 })].map((e) => e.value)).toEqual([
      "III",
      "two",
    ]);
    expect(list.floor({ id: 2 })).toEqual({ key: { id: 2 }, value: "two" });
    expect(list.ceiling({ id: 4 })).toEqual({ key, value: "III" });
  });
  it("uses Go numeric and Unicode ordering", () => {
    const list = new SkipList<number, number>();
    for (const key of [Infinity, -Infinity, NaN, 0, -0, 1]) list.set(key, 1);
    expect([...list.keys()]).toEqual([NaN, -Infinity, 0, 1, Infinity]);
    expect(list.get(NaN)).toBe(1);
    expect(compareOrdered("\u{10000}", "\ue000")).toBe(1);
    expect(compareOrdered(2n, 3n)).toBe(-1);
    expect(() => new SkipList<object, number>().insert({}, 1)).toThrow(
      TypeError,
    );
  });
  it("takes detached shallow snapshots for all iterator variants", () => {
    const list = new SkipList<number, string>();
    for (let i = 0; i < 5; i++) list.insert(i, String(i));
    const iterators = [
      list.all(),
      list.range(1, 4),
      list.rangeFrom(3),
      list.keys(),
      list.values(),
      list[Symbol.iterator](),
    ];
    list.clear();
    expect([...iterators[0]]).toHaveLength(5);
    expect([...iterators[1]]).toHaveLength(3);
    expect([...iterators[2]]).toHaveLength(2);
    expect([...iterators[3]]).toEqual([0, 1, 2, 3, 4]);
    expect([...iterators[4]]).toEqual(["0", "1", "2", "3", "4"]);
    expect([...iterators[5]]).toHaveLength(5);
  });
  it.each([1, 16, 80])(
    "matches a sorted Map across 10,000 mixed operations (maxLevel=%i)",
    (maxLevel) => {
      const rng = random(),
        list = new SkipList<number, number>({ random: rng, maxLevel }),
        ref = new Map<number, number>();
      for (let i = 0; i < 10_000; i++) {
        const key = Math.floor(rng() * 150),
          value = i,
          op = Math.floor(rng() * 4);
        const present = ref.has(key),
          previous = ref.get(key);
        if (op === 0) {
          expect(list.insert(key, value)).toBe(!present);
          if (!present) ref.set(key, value);
        } else if (op === 1) {
          expect(list.set(key, value)).toEqual([previous, present]);
          ref.set(key, value);
        } else if (op === 2) {
          expect(list.delete(key)).toEqual([previous, present]);
          ref.delete(key);
        } else expect(list.get(key)).toBe(previous);
        if (i % 47 === 0) {
          const entries = [...ref]
            .sort((a, b) => a[0] - b[0])
            .map(([key, value]) => ({ key, value }));
          expect(list.snapshot()).toEqual(entries);
          expect(list.length).toBe(ref.size);
          expect(list.min()).toEqual(entries[0]);
          expect(list.max()).toEqual(entries.at(-1));
          expect(list.floor(key)).toEqual(
            entries.filter((e) => e.key <= key).at(-1),
          );
          expect(list.ceiling(key)).toEqual(entries.find((e) => e.key >= key));
          expect([...list.range(key, key + 15)]).toEqual(
            entries.filter((e) => e.key >= key && e.key < key + 15),
          );
          expect([...list.range(key + 1, key)]).toEqual([]);
        }
      }
    },
  );
  it("validates options and random/comparator failures without partial mutation", () => {
    for (const maxLevel of [0, -1, 1.5, 4097, NaN])
      expect(() => new SkipList({ maxLevel })).toThrow();
    for (const probability of [0, 1, NaN, Infinity])
      expect(() => new SkipList({ probability })).toThrow();
    for (const value of [NaN, Infinity, -1, 1]) {
      const list = new SkipList<number, number>({ random: () => value });
      expect(() => list.insert(1, 1)).toThrow();
      expect(list.length).toBe(0);
      expect(list.level).toBe(0);
    }
    const list = new SkipList({ compare: () => NaN });
    expect(() => list.insert(1, 1)).toThrow();
    expect(list.snapshot()).toEqual([]);
  });
});
describe("Go-compatible persistence", () => {
  it("round trips separators, escapes, line breaks, empty fields and Unicode", () => {
    const list = new SkipList<string, string>();
    for (const [key, value] of [
      ["", ""],
      ["a:b", "line\n\r\\end"],
      ["雪", "☃"],
    ])
      list.insert(key, value);
    const text = dump(list, format);
    expect(text).toBe(":\na\\:b:line\\n\\r\\\\end\n雪:☃\n");
    expect(load(text, format).snapshot()).toEqual(list.snapshot());
    expect(
      load("\r\n" + text.replaceAll("\n", "\r\n"), format).snapshot(),
    ).toEqual(list.snapshot());
    expect(load("key:value:tail", format).get("key")).toBe("value:tail");
    const custom = { ...format, separator: "|" };
    expect(load(dump(list, custom), custom).snapshot()).toEqual(
      list.snapshot(),
    );
  });
  it.each(["x", "a:b\na:c\n", "a:bad\\z\n", "a:bad\\", "a\\z:x"])(
    "rejects malformed records: %s",
    (text) => {
      expect(() => load(text, format)).toThrow(ParseError);
    },
  );
  it("reports line numbers and rejects comparator-equal duplicates", () => {
    try {
      load("\nvalid:yes\ninvalid\n", format);
      expect.fail();
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).line).toBe(3);
    }
    expect(() =>
      load("a:1\nA:2", format, {
        compare: (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
      }),
    ).toThrow("duplicate");
    expect(() => load("a:x", { key: intCodec, value: stringCodec })).toThrow(
      ParseError,
    );
    for (const separator of ["", "n", "r", "\\", "雪", "\n", " "])
      expect(() => load("", { ...format, separator })).toThrow();
  });
  it("enforces encoded byte limits", () => {
    expect(() => load("a:" + "x".repeat(MAX_RECORD_SIZE), format)).toThrow(
      "record too large",
    );
    const list = new SkipList<string, string>();
    list.insert("a", "雪".repeat(MAX_RECORD_SIZE / 3));
    expect(() => dump(list, format)).toThrow("record too large");
  });
  it("round trips exact integer boundaries, floats and binary", () => {
    for (const value of [-(1n << 63n), (1n << 63n) - 1n])
      expect(int64Codec.decode(int64Codec.encode(value))).toBe(value);
    expect(uint64Codec.decode(String((1n << 64n) - 1n))).toBe((1n << 64n) - 1n);
    expect(() => int64Codec.decode(String(1n << 63n))).toThrow();
    expect(() => intCodec.decode("9007199254740992")).toThrow();
    for (const value of [NaN, Infinity, -Infinity, -0, 1e-100])
      expect(
        Object.is(float64Codec.decode(float64Codec.encode(value)), value),
      ).toBe(true);
    for (const text of ["", " ", "1abc", "0x10", "1e999"])
      expect(() => float64Codec.decode(text)).toThrow();
    const bytes = new Uint8Array([0, 255, 128]);
    expect([...bytesCodec.decode(bytesCodec.encode(bytes))]).toEqual([
      ...bytes,
    ]);
    expect(() => bytesCodec.decode("%%%")).toThrow();
  });
  it("streams records across chunk boundaries, preserves BOM keys, and bounds oversized input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yukino-skiplist-stream-")),
      path = join(dir, "dump");
    try {
      const list = new SkipList<string, string>();
      list.insert("\ufeffkey", "x".repeat(65530) + "雪😀" + "y".repeat(65540));
      list.insert("next", "line\n\\tail");
      await dumpFile(list, path, format);
      expect((await loadFile(path, format)).snapshot()).toEqual(
        list.snapshot(),
      );
      // Exactly the maximum encoded record length, followed by CRLF.
      await writeFile(path, "a:" + "x".repeat(MAX_RECORD_SIZE - 2) + "\r\n");
      expect((await loadFile(path, format)).get("a")!.length).toBe(
        MAX_RECORD_SIZE - 2,
      );
      await writeFile(path, "a:" + "x".repeat(MAX_RECORD_SIZE));
      await expect(loadFile(path, format)).rejects.toThrow("record too large");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("atomically replaces files and preserves old data on encoding failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yukino-skiplist-")),
      path = join(dir, "sub", "dump");
    try {
      const list = new SkipList<string, string>();
      list.insert("a", "b");
      await dumpFile(list, path, format);
      expect((await loadFile(path, format)).snapshot()).toEqual(
        list.snapshot(),
      );
      const bad = {
        ...format,
        value: {
          encode: () => {
            throw new Error("bad codec");
          },
          decode: (x: string) => x,
        },
      };
      await expect(dumpFile(list, path, bad)).rejects.toThrow("bad codec");
      expect(await readFile(path, "utf8")).toBe("a:b\n");
      await writeFile(path, new Uint8Array([0xff]));
      await expect(loadFile(path, format)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
