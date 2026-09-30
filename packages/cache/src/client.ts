import * as grpc from "@grpc/grpc-js";
import { proto } from "./proto/index.js";
import { Peer } from "./peers.js";

export interface ClientOptions {
  /** Per-call deadline in milliseconds. Defaults to 3000. */
  deadlineMs?: number;
  /**
   * Mark outgoing calls as peer-to-peer traffic (x-peer-request metadata)
   * so the receiving server does not re-propagate the write.
   */
  peerRequest?: boolean;
}

const DEFAULT_DEADLINE_MS = 3000;

export class Client implements Peer {
  private addr: string;
  private grpcClient: any;
  private deadlineMs: number;
  private peerRequest: boolean;

  constructor(addr: string, opts?: ClientOptions) {
    this.addr = addr;
    this.deadlineMs = opts?.deadlineMs ?? DEFAULT_DEADLINE_MS;
    this.peerRequest = opts?.peerRequest ?? false;
    this.grpcClient = new proto.pb.YukinoCache(
      addr,
      grpc.credentials.createInsecure(),
    );
  }

  private callMetadata(): grpc.Metadata {
    const metadata = new grpc.Metadata();
    if (this.peerRequest) {
      metadata.set("x-peer-request", "true");
    }
    return metadata;
  }

  private callOptions(): grpc.CallOptions {
    return {
      deadline: new Date(Date.now() + this.deadlineMs),
    };
  }

  get(group: string, key: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.grpcClient.Get(
        { group, key },
        this.callMetadata(),
        this.callOptions(),
        (err: grpc.ServiceError | null, response: any) => {
          if (err) {
            reject(
              new Error(
                `failed to get value from yukino_cache: ${err.message}`,
              ),
            );
            return;
          }
          resolve(Buffer.from(response.value));
        },
      );
    });
  }

  set(group: string, key: string, value: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.grpcClient.Set(
        { group, key, value },
        this.callMetadata(),
        this.callOptions(),
        (err: grpc.ServiceError | null) => {
          if (err) {
            reject(
              new Error(`failed to set value to yukino_cache: ${err.message}`),
            );
            return;
          }
          resolve();
        },
      );
    });
  }

  delete(group: string, key: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.grpcClient.Delete(
        { group, key },
        this.callMetadata(),
        this.callOptions(),
        (err: grpc.ServiceError | null, response: any) => {
          if (err) {
            reject(
              new Error(
                `failed to delete value from yukino_cache: ${err.message}`,
              ),
            );
            return;
          }
          resolve(response.value);
        },
      );
    });
  }

  async close(): Promise<void> {
    this.grpcClient.close();
  }

  getAddr(): string {
    return this.addr;
  }
}
