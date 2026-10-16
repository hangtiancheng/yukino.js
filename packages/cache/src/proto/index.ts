import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

export interface YukinoProto {
  pb: { YukinoCache: grpc.ServiceClientConstructor };
}

export interface HealthProto {
  grpc: { health: { v1: { Health: grpc.ServiceClientConstructor } } };
}

let cachedProto: YukinoProto | undefined;
let cachedHealthProto: HealthProto | undefined;

/**
 * Loads the cache service definition on first use.
 *
 * The `.proto` files are read from disk, so this must not run at module scope:
 * importing the package (even only for the in-memory `Cache`) would otherwise
 * perform file I/O eagerly and throw when the files are not adjacent to the
 * importing module, e.g. after a consumer bundles this package. Deferring the
 * load keeps the pure in-memory surface free of gRPC/proto work.
 */
export function getProto(): YukinoProto {
  if (cachedProto === undefined) {
    const yukinoDef = protoLoader.loadSync(
      join(__dirname, "yukino.proto"),
      LOADER_OPTIONS,
    );
    cachedProto = grpc.loadPackageDefinition(
      yukinoDef,
    ) as unknown as YukinoProto;
  }
  return cachedProto;
}

/** Loads the gRPC health service definition on first use. See {@link getProto}. */
export function getHealthProto(): HealthProto {
  if (cachedHealthProto === undefined) {
    const healthDef = protoLoader.loadSync(
      join(__dirname, "health.proto"),
      LOADER_OPTIONS,
    );
    cachedHealthProto = grpc.loadPackageDefinition(
      healthDef,
    ) as unknown as HealthProto;
  }
  return cachedHealthProto;
}
