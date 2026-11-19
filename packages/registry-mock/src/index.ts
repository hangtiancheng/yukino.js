import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { EventEmitter } from "node:events";

export interface RegistryOptions {
  http?: number;
  port?: number;
  host?: string;
  maxBodySize?: number;
}
export type RegistryCallback = (
  error: Error | null,
  registry?: Registry,
) => void;
export interface CachedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}
/** A generic request cache with support for npm publish attachments. */
export class Registry extends EventEmitter {
  readonly server: Server;
  readonly cache: Record<string, Buffer | string | null> = Object.create(null);
  readonly port: number;
  readonly host?: string;
  readonly maxBodySize: number;
  constructor(options: RegistryOptions = {}) {
    super();
    this.port = options.http ?? options.port ?? 0;
    this.host = options.host;
    this.maxBodySize = options.maxBodySize ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxBodySize) || this.maxBodySize < 0)
      throw new RangeError("maxBodySize must be a non-negative integer");
    this.server = createServer((req, res) => {
      void this.handler(req, res).catch((error) => {
        if (!res.headersSent)
          this.send(res, 500, { message: (error as Error).message });
        else res.destroy(error as Error);
      });
    });
  }
  private send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }
  async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (
      req.headers["x-fetch-cache"] !== undefined ||
      (req.url ?? "").includes(".tgz")
    ) {
      this.serveCache(req, res);
      return;
    }
    await this.cacheRequest(req, res);
  }
  serveCache(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    const value = this.cache[url];
    if (value === undefined || value === null) {
      this.send(res, 404, { message: `${url} not found.` });
      return;
    }
    res.writeHead(200, {
      "content-type": url.includes(".tgz")
        ? "application/octet-stream"
        : "application/json",
    });
    res.end(value);
    if (req.headers["x-clear-cache"] !== undefined) delete this.cache[url];
  }
  async cacheRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    if (this.cache[url] !== undefined && this.cache[url] !== null) {
      req.resume();
      this.send(res, 200, { message: `Cache exists for ${url}` });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > this.maxBodySize) {
        this.send(res, 413, { message: "Request body too large" });
        req.resume();
        return;
      }
      chunks.push(buffer);
    }
    const body = Buffer.concat(chunks);
    const attachments: [string, Buffer][] = [];
    if (req.method === "PUT" && /^\/(?:@[^/]+(?:%2f|\/))?[\w.-]+$/i.test(url)) {
      try {
        const parsed: unknown = JSON.parse(body.toString());
        if (parsed && typeof parsed === "object" && "_attachments" in parsed) {
          const values = parsed._attachments;
          if (!values || typeof values !== "object")
            throw new Error("Invalid attachments");
          for (const [name, attachment] of Object.entries(values)) {
            if (
              !attachment ||
              typeof attachment !== "object" ||
              !("data" in attachment) ||
              typeof attachment.data !== "string"
            )
              throw new Error("Invalid attachment data");
            if (name.includes("..") || name.startsWith("/"))
              throw new Error("Invalid attachment name");
            attachments.push([
              `${url}/-/${name}`,
              Buffer.from(attachment.data, "base64"),
            ]);
          }
        }
      } catch {
        this.send(res, 400, { message: "Invalid publish payload" });
        return;
      }
    }
    this.cache[url] = body;
    for (const [path, tarball] of attachments) this.cache[path] = tarball;
    let response: { status: number; body: unknown } = {
      body: { message: `Cached data for: ${url}` },
      status: 201,
    };
    const header = req.headers["x-send-response"];
    if (typeof header === "string") {
      try {
        const parsed: unknown = JSON.parse(header);
        if (
          parsed &&
          typeof parsed === "object" &&
          "status" in parsed &&
          Number.isInteger(parsed.status) &&
          Number(parsed.status) >= 200 &&
          Number(parsed.status) <= 599 &&
          "body" in parsed
        )
          response = { status: Number(parsed.status), body: parsed.body };
      } catch {
        /* Malformed response headers retain the default response. */
      }
    }
    this.send(res, response.status, response.body);
    this.emit("cached", {
      method: req.method ?? "GET",
      url,
      headers: { ...req.headers },
      body,
    } satisfies CachedRequest);
  }
  listen(callback?: (error?: Error) => void): this {
    let complete = false;
    const done = (error?: Error) => {
      if (complete) return;
      complete = true;
      this.server.removeListener("error", onError);
      callback?.(error);
    };
    const onError = (error: Error) => {
      if (callback) done(error);
      else this.emit("error", error);
    };
    this.server.once("error", onError);
    this.server.listen(this.port, this.host, () => done());
    return this;
  }
  close(callback?: (error?: Error) => void): this {
    this.server.close(callback);
    return this;
  }
  address(): ReturnType<Server["address"]> {
    return this.server.address();
  }
}
export function registryMock(options?: RegistryOptions): Promise<Registry>;
export function registryMock(
  options: RegistryOptions,
  callback: RegistryCallback,
): void;
export function registryMock(
  options: RegistryOptions = {},
  callback?: RegistryCallback,
): Promise<Registry> | void {
  const promise = new Promise<Registry>((resolve, reject) => {
    const registry = new Registry(options);
    registry.listen((error) => (error ? reject(error) : resolve(registry)));
  });
  if (!callback) return promise;
  void promise.then(
    (registry) => callback(null, registry),
    (error) => callback(error),
  );
}
export const createRegistry = registryMock;
export default Object.assign(registryMock, { Registry });
