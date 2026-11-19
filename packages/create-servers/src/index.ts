import * as http from "node:http";
import * as https from "node:https";
import * as http2 from "node:http2";
import { createSecureContext } from "node:tls";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ListenerOptions {
  port?: number | string;
  host?: string;
  handler?: http.RequestListener;
  timeout?: number;
  keepAliveTimeout?: number;
}
export interface TlsListenerOptions
  extends Omit<https.ServerOptions, "ciphers">, ListenerOptions {
  root?: string;
  ciphers?: string | string[];
  sni?: Record<string, TlsListenerOptions>;
  allowHTTP1?: boolean;
}
export interface CreateServersOptions extends Omit<ListenerOptions, "port"> {
  http?:
    number | string | ListenerOptions | (number | string | ListenerOptions)[];
  https?: TlsListenerOptions | TlsListenerOptions[];
  http2?: TlsListenerOptions | TlsListenerOptions[];
  log?: (message: string, ...args: unknown[]) => void;
}
export interface Servers {
  http?: http.Server | http.Server[];
  https?: https.Server | https.Server[];
  http2?: http2.Http2SecureServer | http2.Http2SecureServer[];
}
export type Server = http.Server | https.Server | http2.Http2SecureServer;
export type ListeningCallback = (
  error: Error | null,
  servers?: Servers,
) => void;

async function material(value: unknown, root: string): Promise<unknown> {
  if (Array.isArray(value))
    return Promise.all(value.map((item) => material(item, root)));
  if (typeof value !== "string" || value.includes("-----BEGIN")) return value;
  return readFile(resolve(root, value));
}
export async function normalizeTlsOptions(
  options: TlsListenerOptions,
): Promise<https.ServerOptions> {
  const root = options.root ?? process.cwd();
  const key = await material(options.key, root);
  let cert = await material(options.cert, root);
  if (Array.isArray(cert) && !Array.isArray(key))
    cert = cert.map((item) => String(item)).join("\n");
  const ca = await material(options.ca, root);
  const result: https.ServerOptions = {
    ...options,
    key: key as https.ServerOptions["key"],
    cert: cert as https.ServerOptions["cert"],
    ca: ca as https.ServerOptions["ca"],
    ciphers: Array.isArray(options.ciphers)
      ? options.ciphers.join(":")
      : options.ciphers,
  };
  if (options.sni && !options.SNICallback) {
    const contexts = await Promise.all(
      Object.entries(options.sni).map(async ([host, config]) => {
        const escapePattern = (value: string) =>
          value
            .split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*");
        const pattern = host.startsWith("*.")
          ? `(?:.*\\.)?${escapePattern(host.slice(2))}`
          : escapePattern(host);
        return {
          pattern: new RegExp(`^${pattern}$`, "i"),
          context: createSecureContext(
            await normalizeTlsOptions({
              ...options,
              sni: undefined,
              ...config,
            }),
          ),
        };
      }),
    );
    result.SNICallback = (hostname, callback) => {
      const match = contexts.find((entry) => entry.pattern.test(hostname));
      if (match) callback(null, match.context);
      else callback(new Error(`Unrecognized hostname: ${hostname}`));
    };
  }
  return result;
}
async function listen(
  server: Server,
  config: ListenerOptions,
  defaultPort: number,
): Promise<Server> {
  const port = Number(config.port ?? defaultPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new RangeError(`Invalid port: ${config.port}`);
  if (config.timeout !== undefined) server.setTimeout(config.timeout);
  if (config.keepAliveTimeout !== undefined && "keepAliveTimeout" in server)
    server.keepAliveTimeout = config.keepAliveTimeout;
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListen);
      reject(error);
    };
    const onListen = () => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListen);
    server.listen({ port, host: config.host });
  });
}
async function closeAll(servers: Server[]): Promise<void> {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
}
async function start(options: CreateServersOptions): Promise<Servers> {
  if (
    options.http === undefined &&
    options.https === undefined &&
    options.http2 === undefined
  )
    throw new Error("http, https, and/or http2 are required options");
  const opened: Server[] = [];
  const result: Servers = {};
  const tasks = (["http", "https", "http2"] as const)
    .filter((protocol) => options[protocol] !== undefined)
    .map(async (protocol) => {
      const value = options[protocol]!;
      const configs = Array.isArray(value) ? value : [value];
      const settled = await Promise.allSettled(
        configs.map(async (raw) => {
          const config: TlsListenerOptions = {
            host: options.host,
            handler: options.handler,
            timeout: options.timeout,
            keepAliveTimeout: options.keepAliveTimeout,
            ...(typeof raw === "object" ? raw : { port: raw }),
          };
          if (!config.handler) throw new Error("handler option is required");
          const server =
            protocol === "http"
              ? http.createServer(config.handler)
              : protocol === "https"
                ? https.createServer(
                    await normalizeTlsOptions(config),
                    config.handler,
                  )
                : http2.createSecureServer(
                    await normalizeTlsOptions(config),
                    config.handler as unknown as (
                      req: http2.Http2ServerRequest,
                      res: http2.Http2ServerResponse,
                    ) => void,
                  );
          await listen(server, config, protocol === "http" ? 80 : 443);
          opened.push(server);
          options.log?.(
            `${protocol} | listening on ${JSON.stringify(server.address())}`,
          );
          return server;
        }),
      );
      const error = settled.find((entry) => entry.status === "rejected");
      if (error?.status === "rejected") throw error.reason;
      const servers = settled.map(
        (entry) => (entry as PromiseFulfilledResult<Server>).value,
      );
      Object.assign(result, {
        [protocol]: Array.isArray(value) ? servers : servers[0],
      });
    });
  const settled = await Promise.allSettled(tasks);
  const errors = settled.filter(
    (entry): entry is PromiseRejectedResult => entry.status === "rejected",
  );
  if (errors.length) {
    await closeAll(opened);
    throw new AggregateError(
      errors.map((entry) => entry.reason),
      errors.map((entry) => String(entry.reason)).join("; "),
    );
  }
  return result;
}
export function createServers(options: CreateServersOptions): Promise<Servers>;
export function createServers(
  options: CreateServersOptions,
  callback: ListeningCallback,
): Promise<void>;
export function createServers(
  options: CreateServersOptions,
  callback?: ListeningCallback,
): Promise<Servers | void> {
  if (!callback) return start(options);
  return start(options).then(
    (servers) => callback(null, servers),
    (error) => callback(error),
  );
}
export const createServer = createServers;
export default createServers;
