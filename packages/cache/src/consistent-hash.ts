import { ConHashConfig, defaultConHashConfig } from "./config.js";

export type ConHashOption = (m: ConHashMap) => void;

export function withConHashConfig(config: ConHashConfig): ConHashOption {
  return (m: ConHashMap) => {
    m.setConfig(config);
  };
}

export class ConHashMap {
  private config: ConHashConfig;
  private keys: number[] = [];
  private hashMap: Map<number, string> = new Map();
  private nodeReplicas: Map<string, number> = new Map();
  private nodeCounts: Map<string, number> = new Map();
  private totalRequests = 0;
  private balancerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(...opts: ConHashOption[]) {
    this.config = { ...defaultConHashConfig };
    for (const opt of opts) {
      opt(this);
    }
    if (this.config.autoRebalance) {
      this.startBalancer();
    }
  }

  setConfig(config: ConHashConfig): void {
    this.config = config;
    if (this.config.autoRebalance && !this.balancerTimer) {
      this.startBalancer();
    } else if (!this.config.autoRebalance && this.balancerTimer) {
      clearInterval(this.balancerTimer);
      this.balancerTimer = null;
    }
  }

  rebalance(): void {
    this.rebalanceNodes();
  }

  add(...nodes: string[]): void {
    if (nodes.length === 0) return;

    for (const node of nodes) {
      if (!node) continue;
      this.addNodeInternal(node, this.config.defaultReplicas);
    }
    this.keys.sort((a, b) => a - b);
  }

  remove(node: string): void {
    if (!node) return;
    this.removeNodeInternal(node);
    this.keys.sort((a, b) => a - b);
  }

  get(key: string): string {
    if (!key) return "";
    if (this.keys.length === 0) return "";

    const hash = this.config.hashFunc(key);
    let idx = this.binarySearch(hash);
    if (idx === this.keys.length) {
      idx = 0;
    }

    const node = this.hashMap.get(this.keys[idx]) || "";
    if (node) {
      this.nodeCounts.set(node, (this.nodeCounts.get(node) || 0) + 1);
      this.totalRequests++;
    }
    return node;
  }

  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    if (this.totalRequests === 0) return stats;
    for (const [node, count] of this.nodeCounts) {
      stats[node] = count / this.totalRequests;
    }
    return stats;
  }

  close(): void {
    if (this.balancerTimer) {
      clearInterval(this.balancerTimer);
      this.balancerTimer = null;
    }
  }

  private addNodeInternal(node: string, replicas: number): void {
    for (let i = 0; i < replicas; i++) {
      const hash = this.config.hashFunc(`${node}-${i}`);
      this.keys.push(hash);
      this.hashMap.set(hash, node);
    }
    this.nodeReplicas.set(node, replicas);
    if (!this.nodeCounts.has(node)) {
      this.nodeCounts.set(node, 0);
    }
  }

  private removeNodeInternal(node: string): void {
    const replicas = this.nodeReplicas.get(node);
    if (!replicas) return;

    for (let i = 0; i < replicas; i++) {
      const hash = this.config.hashFunc(`${node}-${i}`);
      this.hashMap.delete(hash);
      const keyIdx = this.binarySearch(hash);
      if (keyIdx < this.keys.length && this.keys[keyIdx] === hash) {
        this.keys.splice(keyIdx, 1);
      }
    }

    this.nodeReplicas.delete(node);
    this.nodeCounts.delete(node);
  }

  private binarySearch(target: number): number {
    let left = 0;
    let right = this.keys.length;
    while (left < right) {
      const mid = left + ((right - left) >> 1);
      if (this.keys[mid] < target) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }

  private checkAndRebalance(): void {
    if (this.totalRequests < 1000) return;
    if (this.nodeReplicas.size === 0) return;

    const avgLoad = this.totalRequests / this.nodeReplicas.size;
    let maxDiff = 0;
    for (const count of this.nodeCounts.values()) {
      const diff = Math.abs(count - avgLoad);
      if (avgLoad > 0 && diff / avgLoad > maxDiff) {
        maxDiff = diff / avgLoad;
      }
    }

    if (maxDiff > this.config.loadBalanceThreshold) {
      this.rebalanceNodes();
    }
  }

  private rebalanceNodes(): void {
    if (this.nodeReplicas.size === 0) return;

    const avgLoad = this.totalRequests / this.nodeReplicas.size;
    const updates: Map<string, number> = new Map();

    for (const [node, count] of this.nodeCounts) {
      const currentReplicas =
        this.nodeReplicas.get(node) || this.config.defaultReplicas;
      const loadRatio = count / avgLoad;

      let newReplicas: number;
      if (loadRatio > 1) {
        newReplicas = Math.floor(currentReplicas / loadRatio);
      } else {
        newReplicas = Math.floor(currentReplicas * (2 - loadRatio));
      }

      newReplicas = Math.max(newReplicas, this.config.minReplicas);
      newReplicas = Math.min(newReplicas, this.config.maxReplicas);

      if (newReplicas !== currentReplicas) {
        updates.set(node, newReplicas);
      }
    }

    for (const node of updates.keys()) {
      this.removeNodeInternal(node);
    }
    for (const [node, replicas] of updates) {
      this.addNodeInternal(node, replicas);
    }

    for (const node of this.nodeCounts.keys()) {
      this.nodeCounts.set(node, 0);
    }
    this.totalRequests = 0;
    this.keys.sort((a, b) => a - b);
  }

  private startBalancer(): void {
    this.balancerTimer = setInterval(() => this.checkAndRebalance(), 1000);
  }
}
