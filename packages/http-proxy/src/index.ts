import redirects from "follow-redirects";
import { EventEmitter } from "node:events";
import * as http from "node:http";
import * as https from "node:https";
import type { Duplex, Readable } from "node:stream";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";

export type ProxyTarget =
  string | URL | (https.RequestOptions & { host?: string });
export type CookieRewrite = string | Record<string, string> | false;
export interface ProxyOptions {
  target?: ProxyTarget;
  forward?: ProxyTarget;
  agent?: http.Agent | https.Agent | false;
  ssl?: https.ServerOptions;
  ws?: boolean;
  xfwd?: boolean;
  secure?: boolean;
  toProxy?: boolean;
  prependPath?: boolean;
  ignorePath?: boolean;
  localAddress?: string;
  changeOrigin?: boolean;
  preserveHeaderKeyCase?: boolean;
  auth?: string;
  hostRewrite?: string;
  autoRewrite?: boolean;
  protocolRewrite?: string;
  cookieDomainRewrite?: CookieRewrite;
  cookiePathRewrite?: CookieRewrite;
  headers?: http.OutgoingHttpHeaders;
  proxyTimeout?: number;
  timeout?: number;
  followRedirects?: boolean;
  selfHandleResponse?: boolean;
  buffer?: Readable;
}
export type ErrorCallback<T = http.ServerResponse> = (
  error: Error,
  request: http.IncomingMessage,
  response: T,
  target?: ProxyTarget,
) => void;
export type ProxyPass<T = http.ServerResponse> = (
  request: http.IncomingMessage,
  response: T,
  options: ProxyOptions,
  head?: Buffer,
  proxy?: ProxyServer,
  callback?: ErrorCallback<T>,
) => boolean | void;
interface NamedPass<T> {
  name: string;
  run: ProxyPass<T>;
}
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
function cleanHeaders(
  headers: http.IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  const result = { ...headers };
  for (const key of (headers.connection ?? "").split(","))
    delete result[key.trim().toLowerCase()];
  for (const key of hopHeaders) delete result[key];
  return result;
}
function targetOptions(target: ProxyTarget): https.RequestOptions {
  if (typeof target === "object" && !(target instanceof URL))
    return {
      ...target,
      hostname: target.hostname ?? target.host,
      protocol: target.protocol ?? "http:",
    };
  const url = new URL(target);
  return {
    protocol: url.protocol.replace(/^ws/, "http"),
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port || undefined,
    path: url.pathname + url.search,
    auth: url.username
      ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
      : undefined,
  };
}
function outgoing(
  req: http.IncomingMessage,
  options: ProxyOptions,
  websocket = false,
): https.RequestOptions {
  if (!options.target) throw new Error("Must provide a proper URL as target");
  const target = targetOptions(options.target);
  if (!["http:", "https:"].includes(target.protocol!))
    throw new Error(`Unsupported target protocol: ${target.protocol}`);
  let path = options.ignorePath ? "" : (req.url ?? "/");
  if (!options.toProxy && /^https?:\/\//.test(path)) {
    const parsed = new URL(path);
    path = parsed.pathname + parsed.search;
  }
  if (options.prependPath !== false) {
    const base = target.path ?? "/";
    path = !path
      ? base
      : base.includes("?")
        ? base + path
        : `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }
  const headers: http.OutgoingHttpHeaders = websocket
    ? { ...req.headers }
    : cleanHeaders(req.headers);
  Object.assign(headers, options.headers);
  if (options.changeOrigin) {
    const host = target.hostname ?? target.host ?? "localhost";
    headers.host = `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}${target.port ? `:${target.port}` : ""}`;
  }
  if (options.xfwd) {
    const encrypted = !!(req.socket as TLSSocket).encrypted;
    const values: Record<string, string | number> = {
      for: req.socket.remoteAddress ?? "",
      port: req.headers.host?.match(/:(\d+)$/)?.[1] ?? (encrypted ? 443 : 80),
      proto: websocket
        ? encrypted
          ? "wss"
          : "ws"
        : encrypted
          ? "https"
          : "http",
    };
    for (const [key, value] of Object.entries(values)) {
      const header = `x-forwarded-${key}`;
      headers[header] = headers[header]
        ? `${headers[header]},${value}`
        : String(value);
    }
    headers["x-forwarded-host"] ??= req.headers.host;
  }
  const auth = options.auth ?? target.auth;
  if (auth)
    headers.authorization = `Basic ${Buffer.from(auth).toString("base64")}`;
  if (
    ["DELETE", "OPTIONS"].includes(req.method ?? "") &&
    !headers["content-length"] &&
    !headers["transfer-encoding"]
  )
    headers["content-length"] = "0";
  return {
    ...target,
    method: req.method,
    path: path || "/",
    headers,
    agent: options.agent,
    localAddress: options.localAddress,
    rejectUnauthorized: options.secure !== false,
  };
}
function rewriteCookie(
  cookie: string,
  attribute: string,
  mapping?: CookieRewrite,
): string {
  if (mapping === undefined || mapping === false) return cookie;
  return cookie.replace(
    new RegExp(`;\\s*(${attribute})=([^;]*)`, "ig"),
    (original, key: string, value: string) => {
      const replacement =
        typeof mapping === "string"
          ? mapping
          : (mapping[value] ?? mapping["*"]);
      return replacement === undefined
        ? original
        : replacement
          ? `; ${key}=${replacement}`
          : "";
    },
  );
}
function rawResponse(response: http.IncomingMessage): string {
  let text = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`;
  for (let i = 0; i < response.rawHeaders.length; i += 2)
    text += `${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`;
  return text + "\r\n";
}
export interface ProxyEvents {
  error: [
    error: Error,
    request?: http.IncomingMessage,
    response?: http.ServerResponse | Duplex,
    target?: ProxyTarget,
  ];
  start: [
    request: http.IncomingMessage,
    response: http.ServerResponse,
    target?: ProxyTarget,
  ];
  proxyReq: [
    proxyRequest: http.ClientRequest,
    request: http.IncomingMessage,
    response: http.ServerResponse,
    options: ProxyOptions,
  ];
  proxyRes: [
    proxyResponse: http.IncomingMessage,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ];
  proxyReqWs: [
    proxyRequest: http.ClientRequest,
    request: http.IncomingMessage,
    socket: Duplex,
    options: ProxyOptions,
    head: Buffer,
  ];
  end: [
    request: http.IncomingMessage,
    response: http.ServerResponse,
    proxyResponse: http.IncomingMessage,
  ];
  open: [socket: Socket];
  proxySocket: [socket: Socket];
  close: [response: http.IncomingMessage, socket: Socket, head: Buffer];
  econnreset: [
    error: Error,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ];
}
export class ProxyServer extends EventEmitter<ProxyEvents> {
  readonly options: ProxyOptions;
  _server?: http.Server | https.Server;
  readonly webPasses: NamedPass<http.ServerResponse>[] = [];
  readonly wsPasses: NamedPass<Duplex>[] = [];
  private readonly sockets = new Set<Duplex>();
  constructor(options: ProxyOptions = {}) {
    super();
    this.options = { prependPath: true, ...options };
    this.webPasses.push({
      name: "stream",
      run: (req, res, opts, _head, _proxy, cb) => {
        this.stream(req, res, opts, cb);
      },
    });
    this.wsPasses.push({
      name: "stream",
      run: (req, socket, opts, head, _proxy, cb) => {
        this.upgrade(req, socket, head ?? Buffer.alloc(0), opts, cb);
      },
    });
  }
  private fail<T>(
    error: Error,
    req: http.IncomingMessage,
    res: T,
    options: ProxyOptions,
    callback?: ErrorCallback<T>,
  ): void {
    if (callback) callback(error, req, res, options.target);
    else
      this.emit(
        "error",
        error,
        req,
        res as http.ServerResponse | Duplex,
        options.target,
      );
  }
  web(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options?: ProxyOptions | ErrorCallback,
    callback?: ErrorCallback,
  ): void {
    const opts = {
      ...this.options,
      ...(typeof options === "object" ? options : {}),
    };
    const cb = typeof options === "function" ? options : callback;
    try {
      for (const pass of this.webPasses)
        if (pass.run(req, res, opts, undefined, this, cb)) break;
    } catch (error) {
      this.fail(error as Error, req, res, opts, cb);
    }
  }
  ws(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    options?: ProxyOptions | ErrorCallback<Duplex>,
    callback?: ErrorCallback<Duplex>,
  ): void {
    const opts = {
      ...this.options,
      ...(typeof options === "object" ? options : {}),
    };
    const cb = typeof options === "function" ? options : callback;
    try {
      for (const pass of this.wsPasses)
        if (pass.run(req, socket, opts, head, this, cb)) break;
    } catch (error) {
      this.fail(error as Error, req, socket, opts, cb);
    }
  }
  proxyRequest = this.web;
  proxyWebsocketRequest = this.ws;
  private stream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    opts: ProxyOptions,
    callback?: ErrorCallback,
  ): void {
    if (opts.timeout !== undefined)
      req.setTimeout(opts.timeout, () =>
        req.destroy(new Error("Incoming request timed out")),
      );
    const config = outgoing(req, {
      ...opts,
      target: opts.target ?? opts.forward,
    });
    let failed = false;
    const fail = (error: Error) => {
      if (!failed) {
        failed = true;
        this.fail(error, req, res, opts, callback);
      }
    };
    const transport = opts.followRedirects
      ? config.protocol === "https:"
        ? redirects.https
        : redirects.http
      : config.protocol === "https:"
        ? https
        : http;
    const request = (transport.request as typeof https.request)(config);
    if (opts.proxyTimeout !== undefined)
      request.setTimeout(opts.proxyTimeout, () =>
        request.destroy(
          Object.assign(new Error("Proxy request timed out"), {
            code: "ETIMEDOUT",
          }),
        ),
      );
    request.on("error", fail);
    const abort = () => request.destroy();
    const incomingError = (error: Error) => request.destroy(error);
    req.once("error", incomingError);
    req.once("aborted", abort);
    res.once("close", () => {
      if (!res.writableFinished) request.destroy();
    });
    request.once("close", () => {
      req.removeListener("aborted", abort);
      req.removeListener("error", incomingError);
    });
    this.emit("start", req, res, opts.target ?? opts.forward);
    this.emit("proxyReq", request, req, res, opts);
    request.on("response", (response) => {
      this.emit("proxyRes", response, req, res);
      response.once("error", (error) => {
        fail(error);
        res.destroy();
      });
      response.once("aborted", () => res.destroy());
      if (opts.selfHandleResponse) return;
      const headers = cleanHeaders(response.headers);
      if (response.headers["set-cookie"])
        headers["set-cookie"] = response.headers["set-cookie"].map((cookie) =>
          rewriteCookie(
            rewriteCookie(cookie, "domain", opts.cookieDomainRewrite),
            "path",
            opts.cookiePathRewrite,
          ),
        );
      if (
        typeof headers.location === "string" &&
        [201, 301, 302, 307, 308].includes(response.statusCode ?? 0)
      ) {
        try {
          const location = new URL(headers.location);
          const target = targetOptions(opts.target ?? opts.forward!);
          const targetHost = `${target.hostname}${target.port ? `:${target.port}` : ""}`;
          if (location.host === targetHost) {
            const authority =
              opts.hostRewrite ??
              (opts.autoRewrite ? req.headers.host : undefined);
            if (authority) {
              const host = new URL(`${location.protocol}//${authority}`);
              location.hostname = host.hostname;
              location.port = host.port;
            }
            if (opts.protocolRewrite) location.protocol = opts.protocolRewrite;
            headers.location = location.href;
          }
        } catch {
          /* Relative locations are already valid for the client. */
        }
      }
      if (!res.headersSent) {
        for (const [key, value] of Object.entries(headers)) {
          if (value === undefined) continue;
          const rawIndex = response.rawHeaders.findIndex(
            (item, i) => i % 2 === 0 && item.toLowerCase() === key,
          );
          res.setHeader(
            opts.preserveHeaderKeyCase && rawIndex >= 0
              ? response.rawHeaders[rawIndex]!
              : key,
            value,
          );
        }
        res.writeHead(response.statusCode ?? 502, response.statusMessage);
      }
      response.pipe(res);
      response.once("end", () => this.emit("end", req, res, response));
    });
    if (opts.forward && opts.target) {
      const forwardConfig = outgoing(req, { ...opts, target: opts.forward });
      const forward = (
        forwardConfig.protocol === "https:" ? https : http
      ).request(forwardConfig, (response) => response.resume());
      forward.on("error", (error) => this.emit("econnreset", error, req, res));
      (opts.buffer ?? req).pipe(forward);
    }
    (opts.buffer ?? req).pipe(request);
  }
  private upgrade(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    opts: ProxyOptions,
    callback?: ErrorCallback<Duplex>,
  ): void {
    if (
      req.method !== "GET" ||
      req.headers.upgrade?.toLowerCase() !== "websocket"
    ) {
      socket.destroy();
      return;
    }
    const config = outgoing(req, opts, true);
    const request = (config.protocol === "https:" ? https : http).request(
      config,
    );
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      socket.destroy();
      this.fail(error, req, socket, opts, callback);
    };
    request.on("error", fail);
    socket.once("close", () => request.destroy());
    socket.on("error", () => request.destroy());
    if (opts.proxyTimeout !== undefined)
      request.setTimeout(opts.proxyTimeout, () =>
        request.destroy(new Error("Proxy upgrade timed out")),
      );
    request.on("response", (response) => {
      socket.write(rawResponse(response));
      response.pipe(socket);
    });
    request.on("upgrade", (response, upstream, upstreamHead) => {
      request.setTimeout(0);
      this.sockets.add(socket);
      this.sockets.add(upstream);
      const cleanup = () => {
        this.sockets.delete(socket);
        this.sockets.delete(upstream);
        socket.destroy();
        upstream.destroy();
      };
      upstream.on("error", fail);
      upstream.once("close", () => {
        cleanup();
        this.emit("close", response, upstream, upstreamHead);
      });
      socket.once("close", cleanup);
      (socket as Socket).setNoDelay?.(true);
      upstream.setNoDelay(true);
      socket.write(rawResponse(response));
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
      this.emit("open", upstream);
      this.emit("proxySocket", upstream);
    });
    this.emit("proxyReqWs", request, req, socket, opts, head);
    request.end();
  }
  listen(port: number, hostname?: string, callback?: () => void): this {
    if (this._server) throw new Error("Proxy is already listening");
    const handler: http.RequestListener = (req, res) => this.web(req, res);
    this._server = this.options.ssl
      ? https.createServer(this.options.ssl, handler)
      : http.createServer(handler);
    this._server.on("error", (error) => this.emit("error", error));
    if (this.options.ws)
      this._server.on("upgrade", (req, socket, head) =>
        this.ws(req, socket, head),
      );
    this._server.listen(port, hostname, callback);
    return this;
  }
  close(callback?: (error?: Error) => void): this {
    for (const socket of this.sockets) socket.destroy();
    if (this._server) {
      const server = this._server;
      server.close((error) => {
        this._server = undefined;
        callback?.(error);
      });
    } else queueMicrotask(() => callback?.());
    return this;
  }
  before(type: "web", passName: string, callback: ProxyPass): void;
  before(type: "ws", passName: string, callback: ProxyPass<Duplex>): void;
  before(
    type: "web" | "ws",
    passName: string,
    callback: ProxyPass<http.ServerResponse> | ProxyPass<Duplex>,
  ): void {
    this.insert(type, passName, callback, 0);
  }
  after(type: "web", passName: string, callback: ProxyPass): void;
  after(type: "ws", passName: string, callback: ProxyPass<Duplex>): void;
  after(
    type: "web" | "ws",
    passName: string,
    callback: ProxyPass<http.ServerResponse> | ProxyPass<Duplex>,
  ): void {
    this.insert(type, passName, callback, 1);
  }
  private insert(
    type: "web" | "ws",
    name: string,
    run: ProxyPass<http.ServerResponse> | ProxyPass<Duplex>,
    offset: number,
  ): void {
    if (type !== "web" && type !== "ws")
      throw new Error("type must be web or ws");
    const passes = (
      type === "web" ? this.webPasses : this.wsPasses
    ) as NamedPass<http.ServerResponse | Duplex>[];
    const index = passes.findIndex((pass) => pass.name === name);
    if (index < 0) throw new Error(`No such pass: ${name}`);
    passes.splice(index + offset, 0, {
      name: run.name,
      run: run as ProxyPass<http.ServerResponse | Duplex>,
    });
  }
}
export function createProxyServer(options?: ProxyOptions): ProxyServer {
  return new ProxyServer(options);
}
export const createServer = createProxyServer;
export const createProxy = createProxyServer;
export { ProxyServer as Server };
export default {
  createProxyServer,
  createServer,
  createProxy,
  ProxyServer,
  Server: ProxyServer,
};
