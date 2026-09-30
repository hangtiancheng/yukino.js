import { xxh32 } from "@node-rs/xxhash";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BloomFilterConfig {
  /** Size of the bit array in bits. */
  readonly m: number;
  /** Number of hash functions. */
  readonly k: number;
  /** Hash seed. */
  readonly seed: number;
  /** The `n` used at construction time. */
  readonly expectedItems: number;
  /** The `p` used at construction time. */
  readonly falsePositiveRate: number;
}

export interface BloomFilterSnapshot {
  /** Configuration used to create the filter. */
  config: BloomFilterConfig;
  /** Base-64 encoded bit array. */
  data: string;
  /** Number of add() calls recorded before serialization. */
  insertedCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum addressable bit-array size given 32-bit hash arithmetic. */
const MAX_M = 2 ** 32;

/** Pre-computed popcount lookup table for all byte values 0x00–0xFF. */
const POPCNT_TABLE = new Uint8Array(256);
for (let i = 1; i < 256; i++) {
  POPCNT_TABLE[i] = POPCNT_TABLE[i >> 1] + (i & 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Optimal bit-array size:
 *   m = ceil( -n * ln(p) / (ln2)^2 )
 */
function optimalM(n: number, p: number): number {
  return Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
}

/**
 * Optimal number of hash functions:
 *   k = round( (m / n) * ln2 )
 */
function optimalK(m: number, n: number): number {
  return Math.max(1, Math.round((m / n) * Math.LN2));
}

// ---------------------------------------------------------------------------
// BloomFilter
// ---------------------------------------------------------------------------

/**
 * A space-efficient probabilistic data structure for set-membership testing.
 *
 * - No false negatives: `has()` returning `false` guarantees the item was
 *   never added.
 * - Possible false positives: `has()` returning `true` means the item is
 *   *probably* in the set, subject to the configured false-positive rate.
 *
 * Uses double hashing (`h1 + i*h2`) with xxHash32 for
 * fast, well-distributed bit indices.
 */
export class BloomFilter {
  // --- Immutable configuration ---
  public readonly m: number;
  public readonly k: number;
  private readonly seed: number;
  private readonly expectedItems: number;
  private readonly falsePositiveRate: number;

  // --- Mutable state ---
  private bitArray: Uint8Array;
  private insertedCount: number = 0;
  /** Incrementally maintained count of bits set to 1. */
  private setBits: number = 0;

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param expectedItems      Expected number of items to insert (`n`). Must be a positive integer.
   * @param falsePositiveRate  Desired false-positive probability (`p`), in (0, 1).
   * @param seed               Optional hash seed (default `0`). Must be a non-negative 32-bit unsigned integer.
   */
  constructor(
    expectedItems: number,
    falsePositiveRate: number,
    seed: number = 0,
  ) {
    if (!Number.isInteger(expectedItems) || expectedItems <= 0) {
      throw new RangeError(
        `expectedItems must be a positive integer, got ${expectedItems}`,
      );
    }
    if (
      !Number.isFinite(falsePositiveRate) ||
      falsePositiveRate <= 0 ||
      falsePositiveRate >= 1
    ) {
      throw new RangeError(
        `falsePositiveRate must be in (0, 1), got ${falsePositiveRate}`,
      );
    }
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(
        `seed must be a 32-bit unsigned integer, got ${seed}`,
      );
    }

    this.expectedItems = expectedItems;
    this.falsePositiveRate = falsePositiveRate;
    this.seed = seed;
    this.m = optimalM(expectedItems, falsePositiveRate);
    this.k = optimalK(this.m, expectedItems);

    if (this.m > MAX_M) {
      throw new RangeError(
        `Computed bit-array size m=${this.m} exceeds 2^32. ` +
          `Reduce expectedItems or increase falsePositiveRate.`,
      );
    }

    this.bitArray = new Uint8Array(Math.ceil(this.m / 8));
  }

  // -----------------------------------------------------------------------
  // Core API
  // -----------------------------------------------------------------------

  /**
   * Add an item to the filter.
   *
   * Items are namespaced by type to prevent cross-type collisions
   * (e.g. `add(0)` and `add("0")` are distinct entries).
   *
   * @returns `this` for chaining.
   */
  public add(item: string | number | boolean): this {
    const key = typeKey(item);
    const h1 = xxh32(key, this.seed) >>> 0;
    // Force h2 to be odd (and therefore non-zero) to avoid index degeneracy.
    const h2 = (xxh32(key, h1) | 1) >>> 0;

    for (let i = 0; i < this.k; i++) {
      const idx = ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
      const byteIdx = idx >>> 3;
      const bitMask = 1 << (idx & 7);
      if ((this.bitArray[byteIdx] & bitMask) === 0) {
        this.bitArray[byteIdx] |= bitMask;
        this.setBits++;
      }
    }
    this.insertedCount++;
    return this;
  }

  /**
   * Test whether an item *might* be in the set.
   *
   * @returns `true` = possibly present; `false` = definitely absent.
   */
  public has(item: string | number | boolean): boolean {
    const key = typeKey(item);
    const h1 = xxh32(key, this.seed) >>> 0;
    const h2 = (xxh32(key, h1) | 1) >>> 0;

    for (let i = 0; i < this.k; i++) {
      const idx = ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
      if ((this.bitArray[idx >>> 3] & (1 << (idx & 7))) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Bulk-add multiple items.
   *
   * @returns `this` for chaining.
   */
  public addAll(items: Iterable<string | number | boolean>): this {
    for (const item of items) {
      this.add(item);
    }
    return this;
  }

  /**
   * Reset to empty state. Configuration (m, k, seed) is preserved.
   */
  public clear(): void {
    this.bitArray.fill(0);
    this.insertedCount = 0;
    this.setBits = 0;
  }

  // -----------------------------------------------------------------------
  // Set operations
  // -----------------------------------------------------------------------

  /**
   * Return a new filter that is the union of this filter and `other`.
   * Both filters must share identical configuration (m, k, seed).
   */
  public union(other: BloomFilter): BloomFilter {
    this.assertCompatible(other);
    const result = this.clone();
    for (let i = 0; i < result.bitArray.length; i++) {
      result.bitArray[i] |= other.bitArray[i];
    }
    result.recountSetBits();
    result.insertedCount = this.insertedCount + other.insertedCount;
    return result;
  }

  /**
   * Return a deep copy of this filter.
   */
  public clone(): BloomFilter {
    const copy = Object.create(BloomFilter.prototype) as BloomFilter;
    Object.assign(copy, {
      m: this.m,
      k: this.k,
      seed: this.seed,
      expectedItems: this.expectedItems,
      falsePositiveRate: this.falsePositiveRate,
      bitArray: new Uint8Array(this.bitArray),
      insertedCount: this.insertedCount,
      setBits: this.setBits,
    });
    return copy;
  }

  // -----------------------------------------------------------------------
  // Diagnostics
  // -----------------------------------------------------------------------

  /** Number of `add()` calls (not de-duplicated). */
  public get size(): number {
    return this.insertedCount;
  }

  /**
   * Ratio of bits set to 1 — the "saturation" of the filter.
   * A value approaching 1.0 means the false-positive rate has degraded well
   * beyond the configured target.
   */
  public get fillRatio(): number {
    return this.setBits / this.m;
  }

  /**
   * Whether the filter has exceeded 50% fill, indicating the false-positive
   * rate is degrading significantly beyond the configured target.
   */
  public get isSaturated(): boolean {
    return this.fillRatio > 0.5;
  }

  /**
   * Estimate the number of distinct items currently in the filter based on
   * the observed fill ratio:  n* = -(m / k) * ln(1 - X / m)
   * where X is the number of set bits.
   */
  public get estimatedItemCount(): number {
    if (this.setBits === 0) return 0;
    if (this.setBits >= this.m) return Infinity;
    return Math.round(-(this.m / this.k) * Math.log(1 - this.setBits / this.m));
  }

  /** Full construction-time configuration. */
  public getConfig(): BloomFilterConfig {
    return {
      m: this.m,
      k: this.k,
      seed: this.seed,
      expectedItems: this.expectedItems,
      falsePositiveRate: this.falsePositiveRate,
    };
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  /** Serialize to a JSON-safe snapshot (config + base64 data + insert count). */
  public serialize(): BloomFilterSnapshot {
    return {
      config: this.getConfig(),
      data: Buffer.from(this.bitArray).toString("base64"),
      insertedCount: this.insertedCount,
    };
  }

  /**
   * Restore a filter from a snapshot produced by {@link serialize}.
   */
  public static deserialize(snapshot: BloomFilterSnapshot): BloomFilter {
    const { config, data } = snapshot;
    const filter = new BloomFilter(
      config.expectedItems,
      config.falsePositiveRate,
      config.seed,
    );

    if (filter.m !== config.m || filter.k !== config.k) {
      throw new Error(
        `Snapshot config mismatch: expected m=${filter.m}, k=${filter.k}; ` +
          `got m=${config.m}, k=${config.k}`,
      );
    }

    const buf = Buffer.from(data, "base64");
    if (buf.length !== filter.bitArray.length) {
      throw new Error(
        `Snapshot data length mismatch: expected ${filter.bitArray.length} bytes, got ${buf.length}`,
      );
    }

    filter.bitArray = new Uint8Array(buf);
    filter.insertedCount = snapshot.insertedCount ?? NaN;
    filter.recountSetBits();

    return filter;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Recompute setBits by scanning the entire bit array. */
  private recountSetBits(): void {
    let count = 0;
    for (let i = 0; i < this.bitArray.length; i++) {
      count += POPCNT_TABLE[this.bitArray[i]];
    }
    this.setBits = count;
  }

  /** Assert that two filters share identical configuration. */
  private assertCompatible(other: BloomFilter): void {
    if (this.m !== other.m || this.k !== other.k || this.seed !== other.seed) {
      throw new Error(
        `Incompatible filters: this(m=${this.m}, k=${this.k}, seed=${this.seed}) ` +
          `vs other(m=${other.m}, k=${other.k}, seed=${other.seed})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Produce a type-prefixed key to prevent cross-type collisions.
 * e.g. number 0 -> "n:0", string "0" -> "s:0", boolean false -> "b:false"
 */
function typeKey(item: string | number | boolean): string {
  switch (typeof item) {
    case "string":
      return `s:${item}`;
    case "number":
      return `n:${item}`;
    case "boolean":
      return `b:${item}`;
  }
}
