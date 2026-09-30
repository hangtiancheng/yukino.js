import { Etcd3, Lease, Watcher } from "etcd3";
import { getLocalIP } from "./utils.js";
import { log } from "./logger.js";

export interface RegisterConfig {
  endpoints: string[];
  dialTimeout: number;
  leaseTTL: number;
}

export const defaultRegisterConfig: RegisterConfig = {
  endpoints: ["localhost:2379"],
  dialTimeout: 5000,
  leaseTTL: 10,
};

function resolveAdvertiseAddr(addr: string): string {
  let host = "";
  let rest = addr;
  if (addr.startsWith(":")) {
    rest = addr;
  } else if (addr.startsWith("0.0.0.0:")) {
    rest = addr.slice("0.0.0.0".length);
  } else {
    return addr;
  }
  try {
    host = getLocalIP();
  } catch {
    host = "127.0.0.1";
  }
  return `${host}${rest}`;
}

export async function register(
  svcName: string,
  addr: string,
  stopSignal: AbortSignal,
  config?: Partial<RegisterConfig>,
): Promise<void> {
  const cfg: RegisterConfig = { ...defaultRegisterConfig, ...config };
  const client = new Etcd3({ hosts: cfg.endpoints });

  addr = resolveAdvertiseAddr(addr);
  const key = `/services/${svcName}/${addr}`;

  let lease: Lease | null = null;
  let stopped = false;

  const acquire = async (): Promise<void> => {
    if (stopped) return;
    lease = client.lease(cfg.leaseTTL);
    lease.on("lost", (err) => {
      log.warn(`lease lost (${err}), re-registering ${svcName} at ${addr}`);
      if (!stopped) {
        setTimeout(() => {
          acquire().catch((e) => {
            log.error(`failed to re-register service: ${e}`);
          });
        }, 1000);
      }
    });
    await lease.put(key).value(addr);
  };

  stopSignal.addEventListener("abort", async () => {
    stopped = true;
    try {
      if (lease) await lease.revoke();
      await client.delete().key(key);
    } catch {
      // ignore cleanup errors
    } finally {
      client.close();
    }
  });

  await acquire();
  log.info(`Service registered: ${svcName} at ${addr}`);
}

export class ServiceDiscovery {
  private client: Etcd3;
  private svcName: string;
  private watcher: Watcher | null = null;
  private onPut: (addr: string) => void;
  private onDelete: (addr: string) => void;

  constructor(
    svcName: string,
    onPut: (addr: string) => void,
    onDelete: (addr: string) => void,
    config?: Partial<RegisterConfig>,
  ) {
    const cfg: RegisterConfig = { ...defaultRegisterConfig, ...config };
    this.client = new Etcd3({ hosts: cfg.endpoints });
    this.svcName = svcName;
    this.onPut = onPut;
    this.onDelete = onDelete;
  }

  private get keyPrefix(): string {
    return `/services/${this.svcName}/`;
  }

  private addrFromKey(key: string): string {
    return key.startsWith(this.keyPrefix)
      ? key.slice(this.keyPrefix.length)
      : "";
  }

  async fetchAll(): Promise<string[]> {
    const result = await this.client
      .getAll()
      .prefix(`/services/${this.svcName}`);
    const addrs: string[] = [];
    for (const [, value] of Object.entries(result)) {
      const addr = value.toString();
      if (addr) addrs.push(addr);
    }
    return addrs;
  }

  async watch(): Promise<void> {
    this.watcher = await this.client
      .watch()
      .prefix(`/services/${this.svcName}`)
      .create();

    this.watcher.on("put", (kv) => {
      const addr = kv.value.toString() || this.addrFromKey(kv.key.toString());
      if (addr) this.onPut(addr);
    });

    this.watcher.on("delete", (kv) => {
      // delete events carry no value; the address is part of the key
      const addr = this.addrFromKey(kv.key.toString());
      if (addr) this.onDelete(addr);
    });

    this.watcher.on("disconnected", () => {
      log.warn(`etcd watcher disconnected for ${this.svcName}`);
    });

    this.watcher.on("connected", () => {
      log.info(`etcd watcher reconnected for ${this.svcName}, resyncing`);
      this.fetchAll()
        .then((addrs) => {
          for (const addr of addrs) this.onPut(addr);
        })
        .catch((err) => {
          log.error(`failed to resync services: ${err}`);
        });
    });

    this.watcher.on("error", (err) => {
      log.error(`etcd watcher error for ${this.svcName}: ${err}`);
    });
  }

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.cancel();
      this.watcher = null;
    }
    this.client.close();
  }
}
