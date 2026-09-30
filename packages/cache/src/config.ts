import { crc32 } from "./crc32.js";

export interface ConHashConfig {
  defaultReplicas: number;
  minReplicas: number;
  maxReplicas: number;
  hashFunc: (data: string | Buffer) => number;
  loadBalanceThreshold: number;
  autoRebalance?: boolean;
}

export const defaultConHashConfig: ConHashConfig = {
  defaultReplicas: 50,
  minReplicas: 10,
  maxReplicas: 200,
  hashFunc: crc32,
  loadBalanceThreshold: 0.25,
  autoRebalance: false,
};
