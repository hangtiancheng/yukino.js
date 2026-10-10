import { xxh32 } from "@node-rs/xxhash";

export interface BloomFilterConfig {
  readonly m: number;
  readonly k: number;
  readonly seed: number;
  readonly expectedItems: number;
  readonly falsePositiveRate: number;
}

export interface BloomFilterSnapshot {
  config: BloomFilterConfig;
  data: string;
  insertedCount: number;
}

const MAX_M = 2 ** 32;

const POPCNT_TABLE = new Uint8Array(256);
for (let i = 1; i < 256; i++) {
  POPCNT_TABLE[i] = POPCNT_TABLE[i >> 1] + (i & 1);
}

function optimalM(n: number, p: number): number {
  return Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
}

function optimalK(m: number, n: number): number {
  return Math.max(1, Math.round((m / n) * Math.LN2));
}

export class BloomFilter {
  public readonly m: number;
  public readonly k: number;
  private readonly seed: number;
  private readonly expectedItems: number;
  private readonly falsePositiveRate: number;

  private bitArray: Uint8Array;
  private insertedCount: number = 0;
  private setBits: number = 0;

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

  public add(item: string | number | boolean): this {
    const key = typeKey(item);
    const h1 = xxh32(key, this.seed) >>> 0;
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

  public addAll(items: Iterable<string | number | boolean>): this {
    for (const item of items) {
      this.add(item);
    }
    return this;
  }

  public clear(): void {
    this.bitArray.fill(0);
    this.insertedCount = 0;
    this.setBits = 0;
  }

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

  public get size(): number {
    return this.insertedCount;
  }

  public get fillRatio(): number {
    return this.setBits / this.m;
  }

  public get isSaturated(): boolean {
    return this.fillRatio > 0.5;
  }

  public get estimatedItemCount(): number {
    if (this.setBits === 0) return 0;
    if (this.setBits >= this.m) return Infinity;
    return Math.round(-(this.m / this.k) * Math.log(1 - this.setBits / this.m));
  }

  public getConfig(): BloomFilterConfig {
    return {
      m: this.m,
      k: this.k,
      seed: this.seed,
      expectedItems: this.expectedItems,
      falsePositiveRate: this.falsePositiveRate,
    };
  }

  public serialize(): BloomFilterSnapshot {
    return {
      config: this.getConfig(),
      data: Buffer.from(this.bitArray).toString("base64"),
      insertedCount: this.insertedCount,
    };
  }

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

  private recountSetBits(): void {
    let count = 0;
    for (let i = 0; i < this.bitArray.length; i++) {
      count += POPCNT_TABLE[this.bitArray[i]];
    }
    this.setBits = count;
  }

  private assertCompatible(other: BloomFilter): void {
    if (this.m !== other.m || this.k !== other.k || this.seed !== other.seed) {
      throw new Error(
        `Incompatible filters: this(m=${this.m}, k=${this.k}, seed=${this.seed}) ` +
          `vs other(m=${other.m}, k=${other.k}, seed=${other.seed})`,
      );
    }
  }
}

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
