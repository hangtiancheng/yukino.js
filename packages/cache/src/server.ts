import * as grpc from "@grpc/grpc-js";
import { readFileSync } from "fs";
import { proto, healthProto } from "./proto/index.js";
import { getGroup } from "./group.js";
import { register } from "./register.js";
import { log } from "./logger.js";

export interface ServerOptions {
  etcdEndpoints?: string[];
  dialTimeout?: number;
  maxMsgSize?: number;
  tls?: boolean;
  certFile?: string;
  keyFile?: string;
  advertiseAddr?: string;
}

const defaultServerOptions: ServerOptions = {
  etcdEndpoints: ["localhost:2379"],
  dialTimeout: 5000,
  maxMsgSize: 4 << 20,
  tls: false,
};

const PEER_REQUEST_METADATA_KEY = "x-peer-request";

function isPeerRequest(call: grpc.ServerUnaryCall<any, any>): boolean {
  const meta = call.metadata.get(PEER_REQUEST_METADATA_KEY);
  return meta.length > 0 && meta[0] === "true";
}

function requestSignal(call: grpc.ServerUnaryCall<any, any>): AbortSignal {
  const controller = new AbortController();
  call.on("cancelled", () => controller.abort());
  return controller.signal;
}

export class Server {
  private addr: string;
  private svcName: string;
  private grpcServer: grpc.Server;
  private abortController: AbortController;
  private opts: ServerOptions;
  private credentials: grpc.ServerCredentials;

  constructor(addr: string, svcName: string, opts?: Partial<ServerOptions>) {
    this.addr = addr;
    this.svcName = svcName;
    this.opts = { ...defaultServerOptions, ...opts };
    this.abortController = new AbortController();

    const serverOpts: grpc.ServerOptions = {
      "grpc.max_receive_message_length": this.opts.maxMsgSize,
    };

    if (this.opts.tls && this.opts.certFile && this.opts.keyFile) {
      const cert = readFileSync(this.opts.certFile);
      const key = readFileSync(this.opts.keyFile);
      this.credentials = grpc.ServerCredentials.createSsl(null, [
        { cert_chain: cert, private_key: key },
      ]);
    } else {
      this.credentials = grpc.ServerCredentials.createInsecure();
    }

    this.grpcServer = new grpc.Server(serverOpts);
    this.grpcServer.addService(proto.pb.YukinoCache.service, {
      Get: this.handleGet.bind(this),
      Set: this.handleSet.bind(this),
      Delete: this.handleDelete.bind(this),
    });

    const servingStatuses = new Map<string, number>();
    servingStatuses.set(svcName, 1);
    this.grpcServer.addService(healthProto.grpc.health.v1.Health.service, {
      Check: (
        call: grpc.ServerUnaryCall<any, any>,
        callback: grpc.sendUnaryData<any>,
      ) => {
        const service = call.request.service || "";
        const status = servingStatuses.get(service) ?? 0;
        callback(null, { status });
      },
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.grpcServer.bindAsync(this.addr, this.credentials, (err) => {
        if (err) {
          reject(new Error(`failed to listen: ${err.message}`));
          return;
        }
        resolve();
      });
    });

    const registerAddr = this.opts.advertiseAddr || this.addr;
    register(this.svcName, registerAddr, this.abortController.signal, {
      endpoints: this.opts.etcdEndpoints,
      dialTimeout: this.opts.dialTimeout,
    }).catch((err) => {
      log.error(`failed to register service: ${err}`);
    });

    log.info(`Server starting at ${this.addr}`);
  }

  stop(): void {
    this.abortController.abort();
    this.grpcServer.tryShutdown(() => {
      log.info("Server stopped");
    });
  }

  private handleGet(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    const { group: groupName, key } = call.request;
    const group = getGroup(groupName);
    if (!group) {
      callback({
        code: grpc.status.NOT_FOUND,
        message: `group ${groupName} not found`,
      });
      return;
    }

    group
      .get(requestSignal(call), key)
      .then((view) => {
        callback(null, { value: view.byteSlice() });
      })
      .catch((err) => {
        callback({ code: grpc.status.INTERNAL, message: err.message });
      });
  }

  private handleSet(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    const { group: groupName, key, value } = call.request;
    const group = getGroup(groupName);
    if (!group) {
      callback({
        code: grpc.status.NOT_FOUND,
        message: `group ${groupName} not found`,
      });
      return;
    }

    const peerRequest = isPeerRequest(call);
    group
      .set(requestSignal(call), key, Buffer.from(value), peerRequest)
      .then(() => {
        callback(null, { success: true });
      })
      .catch((err) => {
        callback({ code: grpc.status.INTERNAL, message: err.message });
      });
  }

  private handleDelete(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    const { group: groupName, key } = call.request;
    const group = getGroup(groupName);
    if (!group) {
      callback({
        code: grpc.status.NOT_FOUND,
        message: `group ${groupName} not found`,
      });
      return;
    }

    const peerRequest = isPeerRequest(call);
    group
      .delete(requestSignal(call), key, peerRequest)
      .then(() => {
        callback(null, { value: true });
      })
      .catch((err) => {
        callback({ code: grpc.status.INTERNAL, message: err.message });
      });
  }
}
