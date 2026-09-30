import { LruStore } from "./lru.js";
import { Store, StoreOptions, Value } from "./store.js";
import { ByteView } from "./byte-view.js";
import { log } from "./logger.js";

export interface CacheOptions {
  maxBytes?: number;
  bucketCount?: number;
  capPerBucket?: number;
  level2Cap?: number;
  cleanupTime?: number;
  onEvicted?: (key: string, value: Value) => void;
}

export interface CacheStats {
  initialized: boolean;
  closed: boolean;
  hits: number;
  misses: number;
  size?: number;
  hit_rate?: number;
}

export function defaultCacheOptions(): CacheOptions {
  return {
    maxBytes: 8 * 1024 * 1024,
    bucketCount: 16,
    capPerBucket: 512,
    level2Cap: 256,
    cleanupTime: 60_000,
    onEvicted: undefined,
  };
}

export class Cache {
  private store: Store | null = null;
  private opts: CacheOptions;
  private hits = 0;
  private misses = 0;
  private initialized = false;
  private closed = false;

  constructor(opts: CacheOptions) {
    this.opts = opts;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    const storeOpts: StoreOptions = {
      maxBytes: this.opts.maxBytes,
      bucketCount: this.opts.bucketCount,
      capPerBucket: this.opts.capPerBucket,
      level2Cap: this.opts.level2Cap,
      cleanupInterval: this.opts.cleanupTime,
      onEvicted: this.opts.onEvicted,
    };
    this.store = new LruStore(storeOpts);
    this.initialized = true;
    log.info(`Cache initialized, max bytes: ${this.opts.maxBytes}`);
  }

  add(key: string, value: ByteView): void {
    if (this.closed) {
      log.warn(`Attempted to add to a closed cache: ${key}`);
      return;
    }
    this.ensureInitialized();
    this.store!.set(key, value);
  }

  get(key: string): [ByteView | null, boolean] {
    if (this.closed) return [null, false];
    if (!this.initialized) {
      this.misses++;
      return [null, false];
    }

    const [val, found] = this.store!.get(key);
    if (!found || !val) {
      this.misses++;
      return [null, false];
    }

    this.hits++;
    return [val as ByteView, true];
  }

  addWithExpiration(
    key: string,
    value: ByteView,
    expirationTime: number,
  ): void {
    if (this.closed) {
      log.warn(`Attempted to add to a closed cache: ${key}`);
      return;
    }

    const expirationMs = expirationTime - Date.now();
    if (expirationMs <= 0) {
      // writing an already-expired value is equivalent to a delete
      this.delete(key);
      return;
    }

    this.ensureInitialized();
    this.store!.setWithExpiration(key, value, expirationMs);
  }

  delete(key: string): boolean {
    if (this.closed || !this.initialized) return false;
    return this.store!.delete(key);
  }

  clear(): void {
    if (this.closed || !this.initialized) return;
    this.store!.clear();
    this.hits = 0;
    this.misses = 0;
  }

  len(): number {
    if (this.closed || !this.initialized) return 0;
    return this.store!.len();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.store) {
      this.store.close();
      this.store = null;
    }
    this.initialized = false;
    log.info(`Cache closed, hits: ${this.hits}, misses: ${this.misses}`);
  }

  stats(): CacheStats {
    const s: CacheStats = {
      initialized: this.initialized,
      closed: this.closed,
      hits: this.hits,
      misses: this.misses,
    };

    if (this.initialized) {
      s.size = this.len();
      const totalRequests = this.hits + this.misses;
      s.hit_rate = totalRequests > 0 ? this.hits / totalRequests : 0;
    }

    return s;
  }
}
