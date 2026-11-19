import { createServer } from "node:net";
import { mkdir, lstat } from "node:fs/promises";
import { dirname, extname } from "node:path";

export interface PortFinderOptions {
  host?: string;
  port?: number;
  startPort?: number;
  stopPort?: number;
}
export interface SocketFinderOptions {
  path?: string;
  mod?: number;
}
export type Callback<T> = (error: Error | null, value?: T) => void;
export let basePort = 8000;
export let highestPort = 65535;
export let basePath = "/tmp/portfinder";
function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new RangeError("Port must be an integer between 0 and 65535");
}
export function setBasePort(port: number): void {
  validatePort(port);
  basePort = port;
}
export function setHighestPort(port: number): void {
  validatePort(port);
  highestPort = port;
}
export function setBasePath(path: string): void {
  if (!path) throw new TypeError("Path is required");
  basePath = path;
}
function callbackOrPromise<T>(
  promise: Promise<T>,
  callback?: Callback<T>,
): Promise<T> | void {
  if (!callback) return promise;
  void promise.then(
    (value) => callback(null, value),
    (error) => callback(error),
  );
}
async function probe(port: number, host?: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES")
        resolve(undefined);
      else reject(error);
    });
    server.listen({ port, host, exclusive: true }, () => {
      const address = server.address();
      const found =
        typeof address === "object" && address ? address.port : port;
      server.close((error) => (error ? reject(error) : resolve(found)));
    });
  });
}
export async function getPortPromise(
  options: PortFinderOptions = {},
): Promise<number> {
  const start = options.port ?? options.startPort ?? basePort;
  const stop = options.stopPort ?? highestPort;
  validatePort(start);
  validatePort(stop);
  if (start > stop) throw new RangeError("Starting port exceeds stopPort");
  for (let port = start; port <= stop; port++) {
    const found = await probe(port, options.host);
    if (found !== undefined) return found;
  }
  throw new Error(`No open ports available between ${start} and ${stop}`);
}
export function getPort(options?: PortFinderOptions): Promise<number>;
export function getPort(callback: Callback<number>): void;
export function getPort(
  options: PortFinderOptions,
  callback: Callback<number>,
): void;
export function getPort(
  options: PortFinderOptions | Callback<number> = {},
  callback?: Callback<number>,
): Promise<number> | void {
  return callbackOrPromise(
    getPortPromise(typeof options === "function" ? {} : options),
    typeof options === "function" ? options : callback,
  );
}
export async function getPortsPromise(
  count: number,
  options: PortFinderOptions = {},
): Promise<number[]> {
  if (!Number.isInteger(count) || count < 0)
    throw new RangeError("Count must be a non-negative integer");
  const ports: number[] = [];
  let port = options.port ?? options.startPort ?? basePort;
  while (ports.length < count) {
    const found = await getPortPromise({ ...options, port });
    if (!ports.includes(found)) ports.push(found);
    port = found + 1;
  }
  return ports;
}
export function getPorts(
  count: number,
  options?: PortFinderOptions,
): Promise<number[]>;
export function getPorts(count: number, callback: Callback<number[]>): void;
export function getPorts(
  count: number,
  options: PortFinderOptions,
  callback: Callback<number[]>,
): void;
export function getPorts(
  count: number,
  options: PortFinderOptions | Callback<number[]> = {},
  callback?: Callback<number[]>,
): Promise<number[]> | void {
  return callbackOrPromise(
    getPortsPromise(count, typeof options === "function" ? {} : options),
    typeof options === "function" ? options : callback,
  );
}
export async function getSocketPromise(
  options: SocketFinderOptions = {},
): Promise<string> {
  const path = options.path ?? `${basePath}.sock`;
  await mkdir(dirname(path), { recursive: true, mode: options.mod ?? 0o755 });
  const ext = extname(path);
  const stem = ext ? path.slice(0, -ext.length) : path;
  for (let index = 0; ; index++) {
    const candidate = index ? `${stem}${index}${ext}` : path;
    try {
      await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }
}
export function getSocket(options?: SocketFinderOptions): Promise<string>;
export function getSocket(callback: Callback<string>): void;
export function getSocket(
  options: SocketFinderOptions,
  callback: Callback<string>,
): void;
export function getSocket(
  options: SocketFinderOptions | Callback<string> = {},
  callback?: Callback<string>,
): Promise<string> | void {
  return callbackOrPromise(
    getSocketPromise(typeof options === "function" ? {} : options),
    typeof options === "function" ? options : callback,
  );
}
export default {
  getPort,
  getPortPromise,
  getPorts,
  getPortsPromise,
  getSocket,
  getSocketPromise,
  setBasePort,
  setHighestPort,
  setBasePath,
  get basePort() {
    return basePort;
  },
  get highestPort() {
    return highestPort;
  },
  get basePath() {
    return basePath;
  },
};
