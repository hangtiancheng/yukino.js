export interface Value {
  len(): number;
}

export interface Store {
  get(key: string): [Value | null, boolean];
  set(key: string, value: Value): void;
  setWithExpiration(key: string, value: Value, expirationMs: number): void;
  delete(key: string): boolean;
  clear(): void;
  len(): number;
  close(): void;
}

export interface StoreOptions {
  maxBytes?: number;
  bucketCount?: number;
  capPerBucket?: number;
  level2Cap?: number;
  cleanupInterval?: number;
  onEvicted?: (key: string, value: Value) => void;
}

export function defaultStoreOptions(): StoreOptions {
  return {
    maxBytes: 8192,
    bucketCount: 16,
    capPerBucket: 512,
    level2Cap: 256,
    cleanupInterval: 60_000,
    onEvicted: undefined,
  };
}
