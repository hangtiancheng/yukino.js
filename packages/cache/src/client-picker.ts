import { Peer, PeerPicker } from "./peers.js";
import { ConHashMap } from "./consistent-hash.js";
import { Client } from "./client.js";
import { ServiceDiscovery } from "./register.js";
import { validPeerAddr } from "./utils.js";
import { log } from "./logger.js";

const DEFAULT_SVC_NAME = "yukino_cache";

export interface PickerOption {
  serviceName?: string;
  etcdEndpoints?: string[];
  /** Per-call deadline for peer RPCs in milliseconds. */
  peerDeadlineMs?: number;
}

export class ClientPicker implements PeerPicker {
  private selfAddr: string;
  private svcName: string;
  private consHash: ConHashMap;
  private clients: Map<string, Client> = new Map();
  private discovery: ServiceDiscovery;
  private peerDeadlineMs?: number;

  constructor(addr: string, opts?: PickerOption) {
    this.selfAddr = addr;
    this.svcName = opts?.serviceName || DEFAULT_SVC_NAME;
    this.peerDeadlineMs = opts?.peerDeadlineMs;
    this.consHash = new ConHashMap();

    this.discovery = new ServiceDiscovery(
      this.svcName,
      (peerAddr) => this.onPeerDiscovered(peerAddr),
      (peerAddr) => this.onPeerRemoved(peerAddr),
      opts?.etcdEndpoints ? { endpoints: opts.etcdEndpoints } : undefined,
    );
  }

  async start(): Promise<void> {
    // self participates in the ring so key ownership is globally consistent
    this.consHash.add(this.selfAddr);

    const addrs = await this.discovery.fetchAll();
    for (const addr of addrs) {
      if (addr && addr !== this.selfAddr) {
        this.addPeer(addr);
      }
    }
    await this.discovery.watch();
  }

  pickPeer(key: string): [Peer | null, boolean, boolean] {
    const addr = this.consHash.get(key);
    if (!addr) return [null, false, false];
    if (addr === this.selfAddr) return [null, true, true];
    const client = this.clients.get(addr);
    if (client) return [client, true, false];
    return [null, false, false];
  }

  async close(): Promise<void> {
    this.consHash.close();
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    await this.discovery.close();
  }

  printPeers(): void {
    log.info("Discovered peers:");
    for (const addr of this.clients.keys()) {
      log.info(`  - ${addr}`);
    }
  }

  private onPeerDiscovered(addr: string): void {
    if (addr === this.selfAddr) return;
    if (this.clients.has(addr)) return;
    this.addPeer(addr);
  }

  private onPeerRemoved(addr: string): void {
    if (addr === this.selfAddr) return;
    const client = this.clients.get(addr);
    if (client) {
      client.close();
      this.clients.delete(addr);
      this.consHash.remove(addr);
      log.info(`Service removed at ${addr}`);
    }
  }

  private addPeer(addr: string): void {
    if (!validPeerAddr(addr)) {
      log.warn(`ignoring invalid peer address from registry: ${addr}`);
      return;
    }
    const client = new Client(addr, {
      peerRequest: true,
      deadlineMs: this.peerDeadlineMs,
    });
    this.consHash.add(addr);
    this.clients.set(addr, client);
    log.info(`New peer discovered at ${addr}`);
  }
}
