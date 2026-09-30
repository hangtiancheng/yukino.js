import { describe, it, expect, beforeEach } from "vitest";
import {
  Group,
  newGroup,
  getGroup,
  listGroups,
  destroyGroup,
  destroyAllGroups,
  withExpiration,
  withPeers,
  withCacheOptions,
  Getter,
} from "../src/group.js";
import { Peer, PeerPicker } from "../src/peers.js";

class FakePeer implements Peer {
  getFunc?: (group: string, key: string) => Promise<Buffer>;
  setFunc?: (group: string, key: string, value: Buffer) => Promise<void>;
  deleteFunc?: (group: string, key: string) => Promise<boolean>;

  async get(group: string, key: string): Promise<Buffer> {
    if (this.getFunc) return this.getFunc(group, key);
    throw new Error("get not implemented");
  }

  async set(group: string, key: string, value: Buffer): Promise<void> {
    if (this.setFunc) return this.setFunc(group, key, value);
  }

  async delete(group: string, key: string): Promise<boolean> {
    if (this.deleteFunc) return this.deleteFunc(group, key);
    return true;
  }

  async close(): Promise<void> {}
}

class FakePeerPicker implements PeerPicker {
  peer: Peer | null;
  ok: boolean;
  isSelf: boolean;

  constructor(peer: Peer | null = null, ok = false, isSelf = false) {
    this.peer = peer;
    this.ok = ok;
    this.isSelf = isSelf;
  }

  pickPeer(_key: string): [Peer | null, boolean, boolean] {
    return [this.peer, this.ok, this.isSelf];
  }

  async close(): Promise<void> {}
}

beforeEach(() => {
  destroyAllGroups();
});

describe("Group get caches local values", () => {
  it("only calls loader once for repeated gets", async () => {
    let loads = 0;
    const group = newGroup("group-cache-local", 1024, async (_ctx, key) => {
      loads++;
      return Buffer.from("value-" + key);
    });

    const signal = AbortSignal.abort();
    // use a non-aborted signal for real calls
    const ctrl = new AbortController();

    for (let i = 0; i < 2; i++) {
      const view = await group.get(ctrl.signal, "key");
      expect(view.toString()).toBe("value-key");
    }
    expect(loads).toBe(1);

    const stats = group.getStats();
    expect(stats["local_hits"]).toBe(1);
    expect(stats["local_misses"]).toBe(1);

    group.close();
  });
});

describe("Group validation and close", () => {
  it("rejects empty key on get", async () => {
    const group = newGroup("group-val", 1024, async () => Buffer.from("value"));
    const ctrl = new AbortController();

    await expect(group.get(ctrl.signal, "")).rejects.toThrow();
    group.close();
  });

  it("rejects empty key on set", async () => {
    const group = newGroup("group-val-set", 1024, async () =>
      Buffer.from("value"),
    );
    const ctrl = new AbortController();

    await expect(
      group.set(ctrl.signal, "", Buffer.from("value")),
    ).rejects.toThrow();
    group.close();
  });

  it("rejects empty value on set", async () => {
    const group = newGroup("group-val-set2", 1024, async () =>
      Buffer.from("value"),
    );
    const ctrl = new AbortController();

    await expect(
      group.set(ctrl.signal, "key", Buffer.alloc(0)),
    ).rejects.toThrow();
    group.close();
  });

  it("rejects empty key on delete", async () => {
    const group = newGroup("group-val-del", 1024, async () =>
      Buffer.from("value"),
    );
    const ctrl = new AbortController();

    await expect(group.delete(ctrl.signal, "")).rejects.toThrow();
    group.close();
  });

  it("operations fail after close", async () => {
    const group = newGroup("group-closed", 1024, async () =>
      Buffer.from("value"),
    );
    const ctrl = new AbortController();

    group.close();
    await expect(group.get(ctrl.signal, "key")).rejects.toThrow();
    await expect(
      group.set(ctrl.signal, "key", Buffer.from("v")),
    ).rejects.toThrow();
    await expect(group.delete(ctrl.signal, "key")).rejects.toThrow();
  });
});

describe("Group throws on nil getter", () => {
  it("throws when getter is null", () => {
    expect(() =>
      newGroup("nil-getter", 1024, null as unknown as Getter),
    ).toThrow();
  });
});

describe("Group set, delete, clear, and expiration", () => {
  it("set then get returns manual value", async () => {
    const group = newGroup(
      "group-set-del",
      1024,
      async () => Buffer.from("loaded"),
      withExpiration(20),
    );
    const ctrl = new AbortController();

    await group.set(ctrl.signal, "key", Buffer.from("manual"));
    const view = await group.get(ctrl.signal, "key");
    expect(view.toString()).toBe("manual");

    await group.delete(ctrl.signal, "key");
    // after delete, get should call loader
    const view2 = await group.get(ctrl.signal, "key");
    expect(view2.toString()).toBe("loaded");

    group.clear();
    group.close();
  });
});

describe("Group uses remote peer", () => {
  it("fetches from peer and clones bytes", async () => {
    const remote = Buffer.from("remote");
    const peer = new FakePeer();
    peer.getFunc = async () => remote;

    const group = newGroup("group-remote", 1024, async () => {
      throw new Error("local getter should not run");
    });

    group.registerPeers(new FakePeerPicker(peer, true, false));

    const ctrl = new AbortController();
    const view = await group.get(ctrl.signal, "key");

    remote[0] = 0x58; // 'X'
    expect(view.toString()).toBe("remote");

    group.close();
  });
});

describe("Group falls back when peer fails", () => {
  it("falls back to local getter on peer error", async () => {
    let localLoads = 0;
    const peer = new FakePeer();
    peer.getFunc = async () => {
      throw new Error("remote unavailable");
    };

    const group = newGroup("group-fallback", 1024, async () => {
      localLoads++;
      return Buffer.from("local");
    });

    group.registerPeers(new FakePeerPicker(peer, true, false));

    const ctrl = new AbortController();
    const view = await group.get(ctrl.signal, "key");
    expect(view.toString()).toBe("local");
    expect(localLoads).toBe(1);
    expect(group.getStats()["peer_misses"]).toBe(1);

    group.close();
  });
});

describe("Group set and delete sync to peer", () => {
  it("syncs set and delete to peer, skips peer-originated requests", async () => {
    const synced: string[] = [];
    const peer = new FakePeer();
    peer.setFunc = async (group, key, value) => {
      synced.push(`set:${group}/${key}/${value.toString()}`);
    };
    peer.deleteFunc = async (group, key) => {
      synced.push(`delete:${group}/${key}`);
      return true;
    };

    const group = newGroup(
      "group-sync",
      1024,
      async () => Buffer.from("value"),
      withPeers(new FakePeerPicker(peer, true, false)),
    );

    const ctrl = new AbortController();
    await group.set(ctrl.signal, "key", Buffer.from("value"));
    await new Promise((r) => setTimeout(r, 50));
    expect(synced).toContain("set:group-sync/key/value");

    await group.delete(ctrl.signal, "key");
    await new Promise((r) => setTimeout(r, 50));
    expect(synced).toContain("delete:group-sync/key");

    // peer-originated set should not sync
    const syncedBefore = synced.length;
    await group.set(ctrl.signal, "peer-key", Buffer.from("v"), true);
    await new Promise((r) => setTimeout(r, 50));
    expect(synced.length).toBe(syncedBefore);

    group.close();
  });
});

describe("RegisterPeers throws when called twice", () => {
  it("throws on second call", () => {
    const group = newGroup("group-reg-panic", 1024, async () =>
      Buffer.from("value"),
    );
    group.registerPeers(new FakePeerPicker());

    expect(() => group.registerPeers(new FakePeerPicker())).toThrow();
    group.close();
  });
});

describe("Group suppresses concurrent loads", () => {
  it("only calls loader once for concurrent gets", async () => {
    let loads = 0;
    let resolveGate: () => void;
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });

    const group = newGroup("group-sf", 1024, async () => {
      loads++;
      await gate;
      return Buffer.from("value");
    });

    const ctrl = new AbortController();
    const callers = 16;
    const promises = Array.from({ length: callers }, () =>
      group.get(ctrl.signal, "key"),
    );

    await new Promise((r) => setTimeout(r, 20));
    resolveGate!();

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.toString()).toBe("value");
    }
    expect(loads).toBe(1);

    group.close();
  });
});

describe("Group registry operations", () => {
  it("getGroup returns created group", () => {
    const group = newGroup("group-registry", 1024, async () =>
      Buffer.from("value"),
    );
    expect(getGroup("group-registry")).toBe(group);
    group.close();
  });

  it("listGroups returns all group names", () => {
    newGroup("g-a", 1024, async () => Buffer.from("a"));
    newGroup("g-b", 1024, async () => Buffer.from("b"));
    const names = listGroups();
    expect(names).toContain("g-a");
    expect(names).toContain("g-b");
  });

  it("destroyGroup removes group", () => {
    newGroup("g-destroy", 1024, async () => Buffer.from("val"));
    expect(destroyGroup("g-destroy")).toBe(true);
    expect(destroyGroup("g-destroy")).toBe(false);
    expect(getGroup("g-destroy")).toBeUndefined();
  });

  it("destroyAllGroups removes all groups", () => {
    newGroup("all-a", 1024, async () => Buffer.from("a"));
    newGroup("all-b", 1024, async () => Buffer.from("b"));
    destroyAllGroups();
    expect(listGroups().length).toBe(0);
  });
});

describe("Group options", () => {
  it("withCacheOptions applies custom config", () => {
    const group = newGroup(
      "group-opts",
      1024,
      async () => Buffer.from("value"),
      withCacheOptions({ maxBytes: 64, cleanupTime: 3_600_000 }),
    );
    group.close();
  });

  it("withExpiration sets expiration", async () => {
    const group = newGroup(
      "group-exp",
      1024,
      async () => Buffer.from("loaded"),
      withExpiration(50),
    );
    const ctrl = new AbortController();
    await group.set(ctrl.signal, "key", Buffer.from("manual"));

    const view = await group.get(ctrl.signal, "key");
    expect(view.toString()).toBe("manual");

    group.close();
  });
});

describe("Group getName", () => {
  it("returns the group name", () => {
    const group = newGroup("named-group", 1024, async () => Buffer.from("val"));
    expect(group.getName()).toBe("named-group");
    group.close();
  });
});
