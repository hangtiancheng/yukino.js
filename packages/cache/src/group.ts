import { ByteView, cloneBytes } from "./byte-view.js";
import {
  Cache,
  CacheOptions,
  CacheStats,
  defaultCacheOptions,
} from "./cache.js";
import { Peer, PeerPicker } from "./peers.js";
import { SingleFlightGroup } from "./single-flight.js";
import { log } from "./logger.js";

export type Getter = (ctx: AbortSignal, key: string) => Promise<Buffer>;

export interface GroupOption {
  (g: Group): void;
}

export function withExpiration(ms: number): GroupOption {
  return (g: Group) => {
    g._setExpiration(ms);
  };
}

export function withPeers(peers: PeerPicker): GroupOption {
  return (g: Group) => {
    g._setPeers(peers);
  };
}

export function withCacheOptions(opts: CacheOptions): GroupOption {
  return (g: Group) => {
    g._setCacheOptions(opts);
  };
}

const ErrKeyRequired = new Error("key is required");
const ErrValueRequired = new Error("value is required");
const ErrGroupClosed = new Error("cache group is closed");

interface GroupCounters {
  loads: number;
  localHits: number;
  localMisses: number;
  peerHits: number;
  peerMisses: number;
  loaderHits: number;
  loaderErrors: number;
  loadDuration: number;
}

export interface GroupStats {
  name: string;
  closed: boolean;
  expiration: number;
  loads: number;
  local_hits: number;
  local_misses: number;
  peer_hits: number;
  peer_misses: number;
  loader_hits: number;
  loader_errors: number;
  hit_rate?: number;
  avg_load_time_ms?: number;
  cache: CacheStats;
}

const groups: Map<string, Group> = new Map();

/**
 * Group implements a read-through cache with cache-aside write propagation.
 *
 * Consistency model: set/delete are applied locally and forwarded
 * asynchronously to the single peer that owns the key on the hash ring
 * (fire-and-forget). Other nodes are NOT notified, so their local caches
 * may serve stale values until eviction or expiration. This is weak,
 * eventually-consistent semantics, not replication.
 */
export class Group {
  private name: string;
  private getter: Getter;
  private mainCache: Cache;
  private peers: PeerPicker | null = null;
  private loader: SingleFlightGroup;
  private expiration = 0;
  private closed = false;
  private counters: GroupCounters = {
    loads: 0,
    localHits: 0,
    localMisses: 0,
    peerHits: 0,
    peerMisses: 0,
    loaderHits: 0,
    loaderErrors: 0,
    loadDuration: 0,
  };

  constructor(
    name: string,
    cacheBytes: number,
    getter: Getter,
    ...opts: GroupOption[]
  ) {
    if (!getter) throw new Error("nil Getter");

    this.name = name;
    this.getter = getter;

    const cacheOpts = defaultCacheOptions();
    cacheOpts.maxBytes = cacheBytes;
    this.mainCache = new Cache(cacheOpts);
    this.loader = new SingleFlightGroup();

    for (const opt of opts) {
      opt(this);
    }
  }

  async get(ctx: AbortSignal, key: string): Promise<ByteView> {
    if (this.closed) throw ErrGroupClosed;
    if (!key) throw ErrKeyRequired;

    const [view, ok] = this.mainCache.get(key);
    if (ok && view) {
      this.counters.localHits++;
      return view;
    }

    this.counters.localMisses++;
    return this.load(ctx, key);
  }

  async set(
    ctx: AbortSignal,
    key: string,
    value: Buffer,
    isPeerRequest = false,
  ): Promise<void> {
    if (this.closed) throw ErrGroupClosed;
    if (!key) throw ErrKeyRequired;
    if (!value || value.length === 0) throw ErrValueRequired;

    const view = new ByteView(cloneBytes(value));
    if (this.expiration > 0) {
      this.mainCache.addWithExpiration(key, view, Date.now() + this.expiration);
    } else {
      this.mainCache.add(key, view);
    }

    if (!isPeerRequest && this.peers) {
      this.syncToPeers("set", key, value);
    }
  }

  async delete(
    ctx: AbortSignal,
    key: string,
    isPeerRequest = false,
  ): Promise<void> {
    if (this.closed) throw ErrGroupClosed;
    if (!key) throw ErrKeyRequired;

    this.mainCache.delete(key);

    if (!isPeerRequest && this.peers) {
      this.syncToPeers("delete", key, null);
    }
  }

  clear(): void {
    if (this.closed) return;
    this.mainCache.clear();
    log.info(`cleared cache for group [${this.name}]`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.mainCache.close();
    groups.delete(this.name);
    log.info(`closed cache group [${this.name}]`);
  }

  registerPeers(peers: PeerPicker): void {
    if (this.peers) throw new Error("RegisterPeers called more than once");
    this.peers = peers;
    log.info(`registered peers for group [${this.name}]`);
  }

  getStats(): GroupStats {
    const totalGets = this.counters.localHits + this.counters.localMisses;
    const s: GroupStats = {
      name: this.name,
      closed: this.closed,
      expiration: this.expiration,
      loads: this.counters.loads,
      local_hits: this.counters.localHits,
      local_misses: this.counters.localMisses,
      peer_hits: this.counters.peerHits,
      peer_misses: this.counters.peerMisses,
      loader_hits: this.counters.loaderHits,
      loader_errors: this.counters.loaderErrors,
      cache: this.mainCache.stats(),
    };

    if (totalGets > 0) {
      s.hit_rate = this.counters.localHits / totalGets;
    }
    if (this.counters.loads > 0) {
      s.avg_load_time_ms = this.counters.loadDuration / this.counters.loads;
    }

    return s;
  }

  getName(): string {
    return this.name;
  }

  _setExpiration(ms: number): void {
    this.expiration = ms;
  }

  _setPeers(peers: PeerPicker): void {
    this.peers = peers;
  }

  _setCacheOptions(opts: CacheOptions): void {
    this.mainCache.close();
    this.mainCache = new Cache(opts);
  }

  private async load(ctx: AbortSignal, key: string): Promise<ByteView> {
    // stats and cache population run inside the single-flight callback so
    // they execute once per actual load, not once per waiting caller
    return this.loader.do(key, async () => {
      const startTime = Date.now();
      const view = await this.loadData(ctx, key);
      this.counters.loadDuration += Date.now() - startTime;
      this.counters.loads++;

      if (this.expiration > 0) {
        this.mainCache.addWithExpiration(
          key,
          view,
          Date.now() + this.expiration,
        );
      } else {
        this.mainCache.add(key, view);
      }

      return view;
    });
  }

  private async loadData(ctx: AbortSignal, key: string): Promise<ByteView> {
    if (this.peers) {
      const [peer, ok, isSelf] = this.peers.pickPeer(key);
      if (ok && !isSelf && peer) {
        try {
          const value = await this.getFromPeer(peer, key);
          this.counters.peerHits++;
          return value;
        } catch (err) {
          this.counters.peerMisses++;
          log.warn(`failed to get from peer: ${err}`);
        }
      }
    }

    try {
      const bytes = await this.getter(ctx, key);
      this.counters.loaderHits++;
      return new ByteView(cloneBytes(bytes));
    } catch (err) {
      this.counters.loaderErrors++;
      throw new Error(`failed to get data: ${err}`);
    }
  }

  private async getFromPeer(peer: Peer, key: string): Promise<ByteView> {
    const bytes = await peer.get(this.name, key);
    return new ByteView(cloneBytes(bytes));
  }

  private syncToPeers(op: string, key: string, value: Buffer | null): void {
    if (!this.peers) return;
    const [peer, ok, isSelf] = this.peers.pickPeer(key);
    if (!ok || isSelf || !peer) return;

    (async () => {
      try {
        switch (op) {
          case "set":
            await peer.set(this.name, key, value!);
            break;
          case "delete":
            await peer.delete(this.name, key);
            break;
        }
      } catch (err) {
        log.warn(`failed to sync ${op} to peer: ${err}`);
      }
    })();
  }
}

export function newGroup(
  name: string,
  cacheBytes: number,
  getter: Getter,
  ...opts: GroupOption[]
): Group {
  if (!getter) throw new Error("nil Getter");

  const g = new Group(name, cacheBytes, getter, ...opts);

  if (groups.has(name)) {
    log.warn(`Group with name ${name} already exists; replacing it`);
  }

  groups.set(name, g);
  log.info(`Created cache group [${name}] with cacheBytes=${cacheBytes}`);
  return g;
}

export function getGroup(name: string): Group | undefined {
  return groups.get(name);
}

export function listGroups(): string[] {
  return Array.from(groups.keys());
}

export function destroyGroup(name: string): boolean {
  const g = groups.get(name);
  if (!g) return false;
  groups.delete(name);
  g.close();
  log.info(`destroyed cache group [${name}]`);
  return true;
}

export function destroyAllGroups(): void {
  const toClose = Array.from(groups.values());
  groups.clear();
  for (const g of toClose) {
    g.close();
    log.info(`destroyed cache group [${g.getName()}]`);
  }
}
