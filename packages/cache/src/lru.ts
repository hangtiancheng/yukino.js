import { Store, StoreOptions, Value } from "./store.js";

const MAX_EXPIRE_AT = Number.MAX_SAFE_INTEGER;

const P = 0;
const N = 1;

interface Node {
  k: string;
  v: Value;
  expireAt: number;
}

class InternalCache {
  private doubleLink: [number, number][];
  private m: Node[];
  private hashMap: Map<string, number>;
  private last: number;
  private cap: number;

  constructor(cap: number) {
    this.cap = cap;
    this.doubleLink = new Array(cap + 1);
    for (let i = 0; i <= cap; i++) {
      this.doubleLink[i] = [0, 0];
    }
    this.m = new Array(cap);
    for (let i = 0; i < cap; i++) {
      this.m[i] = { k: "", v: null as unknown as Value, expireAt: 0 };
    }
    this.hashMap = new Map();
    this.last = 0;
  }

  put(
    key: string,
    val: Value,
    expireAt: number,
    onEvicted?: (key: string, value: Value) => void,
  ): number {
    const idx = this.hashMap.get(key);
    if (idx !== undefined) {
      this.m[idx - 1].v = val;
      this.m[idx - 1].expireAt = expireAt;
      this.adjust(idx, P, N);
      return 0;
    }

    if (this.last === this.cap) {
      const tailIdx = this.doubleLink[0][P];
      const tail = this.m[tailIdx - 1];
      if (onEvicted && tail.expireAt > 0) {
        onEvicted(tail.k, tail.v);
      }

      this.hashMap.delete(tail.k);
      this.hashMap.set(key, tailIdx);
      tail.k = key;
      tail.v = val;
      tail.expireAt = expireAt;
      this.adjust(tailIdx, P, N);
      return 1;
    }

    this.last++;
    if (this.last === 1) {
      this.doubleLink[0][P] = this.last;
    } else {
      this.doubleLink[this.doubleLink[0][N]][P] = this.last;
    }

    this.m[this.last - 1].k = key;
    this.m[this.last - 1].v = val;
    this.m[this.last - 1].expireAt = expireAt;
    this.doubleLink[this.last] = [0, this.doubleLink[0][N]];
    this.hashMap.set(key, this.last);
    this.doubleLink[0][N] = this.last;
    return 1;
  }

  get(key: string): [Node | null, number] {
    const idx = this.hashMap.get(key);
    if (idx !== undefined && this.m[idx - 1].expireAt > 0) {
      this.adjust(idx, P, N);
      return [this.m[idx - 1], 1];
    }
    return [null, 0];
  }

  del(key: string): [Node | null, number, number] {
    const idx = this.hashMap.get(key);
    if (idx !== undefined && this.m[idx - 1].expireAt > 0) {
      const node = this.m[idx - 1];
      const removed: Node = { k: node.k, v: node.v, expireAt: node.expireAt };
      this.hashMap.delete(key);
      node.k = "";
      // node.v = null;
      Reflect.set(node, "v", null);
      node.expireAt = 0;
      this.adjust(idx, N, P);
      return [removed, 1, removed.expireAt];
    }
    return [null, 0, 0];
  }

  evictTail(): Node | null {
    let idx = this.doubleLink[0][P];
    while (idx !== 0 && this.m[idx - 1].expireAt <= 0) {
      idx = this.doubleLink[idx][P];
    }
    if (idx === 0) return null;

    const node = this.m[idx - 1];
    const removed: Node = { k: node.k, v: node.v, expireAt: node.expireAt };
    this.hashMap.delete(node.k);
    node.k = "";
    // node.v = null;
    Reflect.set(node, "v", null);
    node.expireAt = 0;
    this.adjust(idx, N, P);
    return removed;
  }

  walk(walker: (key: string, value: Value, expireAt: number) => boolean): void {
    let idx = this.doubleLink[0][N];
    while (idx !== 0) {
      if (this.m[idx - 1].expireAt > 0) {
        if (
          !walker(
            this.m[idx - 1].k,
            this.m[idx - 1].v,
            this.m[idx - 1].expireAt,
          )
        ) {
          return;
        }
      }
      idx = this.doubleLink[idx][N];
    }
  }

  private adjust(idx: number, f: number, t: number): void {
    if (this.doubleLink[idx][f] !== 0) {
      this.doubleLink[this.doubleLink[idx][t]][f] = this.doubleLink[idx][f];
      this.doubleLink[this.doubleLink[idx][f]][t] = this.doubleLink[idx][t];
      this.doubleLink[idx][f] = 0;
      this.doubleLink[idx][t] = this.doubleLink[0][t];
      this.doubleLink[this.doubleLink[0][t]][f] = idx;
      this.doubleLink[0][t] = idx;
    }
  }
}

export function hashBKRD(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 131 + s.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function maskOfNextPowOf2(cap: number): number {
  cap = cap & 0xffff;
  if (cap > 0 && (cap & (cap - 1)) === 0) {
    return cap - 1;
  }
  cap |= cap >> 1;
  cap |= cap >> 2;
  cap |= cap >> 4;
  return cap | (cap >> 8);
}

function sizeOf(key: string, value: Value | null): number {
  return key.length + (value ? value.len() : 0);
}

export class LruStore implements Store {
  private caches: [InternalCache, InternalCache][];
  private onEvicted?: (key: string, value: Value) => void;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private mask: number;
  private closed = false;
  private bucketBytes: number[];
  private bucketMaxBytes: number;

  constructor(opts: StoreOptions) {
    const bucketCount = opts.bucketCount || 16;
    const capPerBucket = opts.capPerBucket || 1024;
    const level2Cap = opts.level2Cap || 1024;
    const cleanupInterval = opts.cleanupInterval ?? 60_000;
    const maxBytes = opts.maxBytes ?? 0;

    this.mask = maskOfNextPowOf2(bucketCount);
    this.onEvicted = opts.onEvicted;
    this.caches = new Array(this.mask + 1);
    this.bucketBytes = new Array(this.mask + 1).fill(0);
    this.bucketMaxBytes =
      maxBytes > 0 ? Math.max(1, Math.floor(maxBytes / (this.mask + 1))) : 0;

    for (let i = 0; i <= this.mask; i++) {
      this.caches[i] = [
        new InternalCache(capPerBucket),
        new InternalCache(level2Cap),
      ];
    }

    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(
        () => this.cleanupLoop(),
        cleanupInterval,
      );
    }
  }

  get(key: string): [Value | null, boolean] {
    const idx = hashBKRD(key) & this.mask;
    const currentTime = Date.now();

    const [n1, status1] = this.caches[idx][0].del(key);
    if (status1 > 0 && n1) {
      if (currentTime >= n1.expireAt) {
        this.bucketBytes[idx] -= sizeOf(n1.k, n1.v);
        this.removeFromLevel(key, idx, 1);
        if (this.onEvicted) this.onEvicted(n1.k, n1.v);
        return [null, false];
      }
      // promote to L2; drop any stale L2 copy first
      this.removeFromLevel(key, idx, 1);
      this.caches[idx][1].put(key, n1.v, n1.expireAt, (k, v) =>
        this.handleEviction(idx, k, v),
      );
      return [n1.v, true];
    }

    const [n2, status2] = this.caches[idx][1].get(key);
    if (status2 > 0 && n2) {
      if (currentTime >= n2.expireAt) {
        this.removeFromLevel(key, idx, 1);
        if (this.onEvicted && n2.v) this.onEvicted(key, n2.v);
        return [null, false];
      }
      return [n2.v, true];
    }

    return [null, false];
  }

  set(key: string, value: Value): void {
    this.setWithExpiration(key, value, 0);
  }

  setWithExpiration(key: string, value: Value, expirationMs: number): void {
    let expireAt: number;
    if (expirationMs > 0) {
      expireAt = Date.now() + expirationMs;
    } else {
      expireAt = MAX_EXPIRE_AT;
    }

    const idx = hashBKRD(key) & this.mask;
    this.removeFromLevel(key, idx, 0);
    this.removeFromLevel(key, idx, 1);

    this.caches[idx][0].put(key, value, expireAt, (k, v) =>
      this.handleEviction(idx, k, v),
    );
    this.bucketBytes[idx] += sizeOf(key, value);

    if (this.bucketMaxBytes > 0) {
      while (this.bucketBytes[idx] > this.bucketMaxBytes) {
        const victim =
          this.caches[idx][0].evictTail() ?? this.caches[idx][1].evictTail();
        if (!victim) break;
        this.handleEviction(idx, victim.k, victim.v);
      }
    }
  }

  delete(key: string): boolean {
    const idx = hashBKRD(key) & this.mask;
    return this.deleteInternal(key, idx);
  }

  clear(): void {
    const keys = new Set<string>();

    for (let i = 0; i < this.caches.length; i++) {
      this.caches[i][0].walk((key) => {
        keys.add(key);
        return true;
      });
      this.caches[i][1].walk((key) => {
        keys.add(key);
        return true;
      });
    }

    for (const key of keys) {
      this.delete(key);
    }
  }

  len(): number {
    const keys = new Set<string>();
    for (let i = 0; i < this.caches.length; i++) {
      this.caches[i][0].walk((key) => {
        keys.add(key);
        return true;
      });
      this.caches[i][1].walk((key) => {
        keys.add(key);
        return true;
      });
    }
    return keys.size;
  }

  usedBytes(): number {
    let total = 0;
    for (const b of this.bucketBytes) {
      total += b;
    }
    return total;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private handleEviction(idx: number, key: string, value: Value): void {
    this.bucketBytes[idx] -= sizeOf(key, value);
    if (this.onEvicted) this.onEvicted(key, value);
  }

  private removeFromLevel(key: string, idx: number, level: number): boolean {
    const [n, st] = this.caches[idx][level].del(key);
    if (st > 0 && n) {
      this.bucketBytes[idx] -= sizeOf(n.k, n.v);
      return true;
    }
    return false;
  }

  private deleteInternal(key: string, idx: number): boolean {
    const [n1, s1] = this.caches[idx][0].del(key);
    const [n2, s2] = this.caches[idx][1].del(key);
    if (n1) this.bucketBytes[idx] -= sizeOf(n1.k, n1.v);
    if (n2) this.bucketBytes[idx] -= sizeOf(n2.k, n2.v);
    const deleted = s1 > 0 || s2 > 0;

    if (deleted && this.onEvicted) {
      if (n1 && n1.v) {
        this.onEvicted(key, n1.v);
      } else if (n2 && n2.v) {
        this.onEvicted(key, n2.v);
      }
    }

    return deleted;
  }

  private cleanupLoop(): void {
    const currentTime = Date.now();

    for (let i = 0; i < this.caches.length; i++) {
      const expiredKeys = new Set<string>();

      this.caches[i][0].walk((key, _value, expireAt) => {
        if (currentTime >= expireAt) {
          expiredKeys.add(key);
        }
        return true;
      });

      this.caches[i][1].walk((key, _value, expireAt) => {
        if (currentTime >= expireAt) {
          expiredKeys.add(key);
        }
        return true;
      });

      for (const key of expiredKeys) {
        this.deleteInternal(key, i);
      }
    }
  }
}
