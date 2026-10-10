import { describe, it, expect, afterEach } from "vitest";
import { ConHashMap, withConHashConfig } from "../src/consistent-hash.js";

describe("ConHashMap", () => {
  let m: ConHashMap;

  afterEach(() => {
    m?.close();
  });

  it("returns empty string for empty ring", () => {
    m = new ConHashMap(
      withConHashConfig({
        defaultReplicas: 3,
        minReplicas: 1,
        maxReplicas: 10,
        loadBalanceThreshold: 0.25,
        hashFunc: (data) => {
          const s = typeof data === "string" ? data : data.toString();
          const n = parseInt(s, 10);
          return isNaN(n) ? 0 : n;
        },
      }),
    );
    expect(m.get("1")).toBe("");
  });

  it("add nodes and get returns non-empty", () => {
    m = new ConHashMap(
      withConHashConfig({
        defaultReplicas: 3,
        minReplicas: 1,
        maxReplicas: 10,
        loadBalanceThreshold: 0.25,
        hashFunc: (data) => {
          const s = typeof data === "string" ? data : data.toString();
          const n = parseInt(s, 10);
          return isNaN(n) ? 0 : n;
        },
      }),
    );

    m.add("6", "4", "2");

    for (const key of ["2", "11", "23", "27"]) {
      expect(m.get(key)).not.toBe("");
    }
  });

  it("stats are populated after gets", () => {
    m = new ConHashMap(
      withConHashConfig({
        defaultReplicas: 3,
        minReplicas: 1,
        maxReplicas: 10,
        loadBalanceThreshold: 0.25,
        hashFunc: (data) => {
          const s = typeof data === "string" ? data : data.toString();
          const n = parseInt(s, 10);
          return isNaN(n) ? 0 : n;
        },
      }),
    );

    m.add("6", "4", "2");
    m.get("2");
    m.get("11");

    const stats = m.getStats();
    expect(Object.keys(stats).length).toBeGreaterThan(0);
  });

  it("remove node works", () => {
    m = new ConHashMap(
      withConHashConfig({
        defaultReplicas: 3,
        minReplicas: 1,
        maxReplicas: 10,
        loadBalanceThreshold: 0.25,
        hashFunc: (data) => {
          const s = typeof data === "string" ? data : data.toString();
          const n = parseInt(s, 10);
          return isNaN(n) ? 0 : n;
        },
      }),
    );

    m.add("6", "4", "2");
    m.remove("4");

    expect(m.get("11")).not.toBe("");
  });

  it("empty nodes are skipped on add", () => {
    m = new ConHashMap(
      withConHashConfig({
        defaultReplicas: 3,
        minReplicas: 1,
        maxReplicas: 10,
        loadBalanceThreshold: 0.25,
        hashFunc: (data) => {
          const s = typeof data === "string" ? data : data.toString();
          const n = parseInt(s, 10);
          return isNaN(n) ? 0 : n;
        },
      }),
    );
    m.add("6", "", "2");
    expect(m.get("1")).not.toBe("");
  });

  it("remove empty or missing node is no-op", () => {
    m = new ConHashMap(
      withConHashConfig({
        defaultReplicas: 3,
        minReplicas: 1,
        maxReplicas: 10,
        loadBalanceThreshold: 0.25,
        hashFunc: (data) => {
          const s = typeof data === "string" ? data : data.toString();
          const n = parseInt(s, 10);
          return isNaN(n) ? 0 : n;
        },
      }),
    );

    m.add("6", "4");
    m.remove("");
    m.remove("missing");
  });

  it("uses default config with crc32 hash", () => {
    m = new ConHashMap();
    m.add("node-a", "node-b", "node-c");

    const result = m.get("some-key");
    expect(result).not.toBe("");
  });

  it("get returns empty for empty key", () => {
    m = new ConHashMap();
    m.add("node-a");
    expect(m.get("")).toBe("");
  });

  it("rebalance runs without deadlock after many requests", async () => {
    m = new ConHashMap(
      withConHashConfig({
        defaultReplicas: 5,
        minReplicas: 2,
        maxReplicas: 20,
        loadBalanceThreshold: 0.01,
        autoRebalance: true,
        hashFunc: (data) => {
          const s = typeof data === "string" ? data : data.toString();
          let hash = 0;
          for (let i = 0; i < s.length; i++) {
            hash = (hash * 31 + s.charCodeAt(i)) | 0;
          }
          return hash >>> 0;
        },
      }),
    );

    m.add("a", "b", "c");

    for (let i = 0; i < 1200; i++) {
      m.get("key-a");
    }

    await new Promise((r) => setTimeout(r, 1500));

    expect(m.get("key")).not.toBe("");
  });

  it("getStats returns empty for zero requests", () => {
    m = new ConHashMap();
    m.add("node-a");
    const stats = m.getStats();
    expect(Object.keys(stats).length).toBe(0);
  });

  it("add with no arguments is a no-op", () => {
    m = new ConHashMap();
    m.add();
    expect(m.get("key")).toBe("");
  });
});
