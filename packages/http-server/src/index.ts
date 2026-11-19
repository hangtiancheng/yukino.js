import * as http from "node:http";
import * as https from "node:https";
import { createReadStream, existsSync } from "node:fs";
import { stat, realpath, readdir } from "node:fs/promises";
import { resolve, relative, sep, extname, isAbsolute } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { contentType, lookup } from "mime-types";
import { minimatch } from "minimatch";
import {
  createProxyServer,
  type ProxyOptions,
  type ProxyServer,
} from "@yukino.js/http-proxy";

export type Middleware = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  next: () => void,
) => void;
export interface HttpServerOptions {
  root?: string;
  baseDir?: string;
  headers?: Record<string, string>;
  cache?: number | string;
  showDir?: boolean | "true" | "false";
  autoIndex?: boolean | "true" | "false";
  dirOverrides404?: boolean;
  showDotfiles?: boolean;
  hidePermissions?: boolean;
  gzip?: boolean;
  brotli?: boolean;
  forceContentEncoding?: boolean;
  ext?: string | boolean;
  contentType?: string;
  mimetypes?: Record<string, string>;
  username?: string;
  password?: string;
  allowedHosts?: string[];
  coop?: boolean;
  coopHeader?: string;
  cors?: boolean;
  corsHeaders?: string;
  privateNetworkAccess?: boolean;
  robots?: boolean | string;
  proxy?: string;
  proxyAll?: boolean | "true" | "false";
  proxyOptions?: ProxyOptions;
  proxyConfig?: Record<
    string,
    ProxyOptions & { pathRewrite?: Record<string, string> }
  >;
  websocket?: boolean;
  https?: https.ServerOptions;
  timeout?: number;
  before?: Middleware[];
  logFn?: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    error?: Error,
  ) => void;
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function equal(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
function enabled(
  value: boolean | string | undefined,
  fallback = true,
): boolean {
  return value === undefined ? fallback : value !== false && value !== "false";
}
function fail(status: number): Error & { status: number } {
  return Object.assign(new Error(http.STATUS_CODES[status]), { status });
}
function accepts(header: string | undefined, encoding: string): boolean {
  const parts = (header ?? "").split(",").map((part) => part.trim().split(";"));
  const entry =
    parts.find((part) => part[0] === encoding) ??
    parts.find((part) => part[0] === "*");
  return (
    !!entry &&
    !entry.slice(1).some((value) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(value))
  );
}
export class HttpServer {
  readonly root: string;
  readonly server: http.Server | https.Server;
  readonly headers: Record<string, string>;
  readonly options: HttpServerOptions;
  private readonly proxy?: ProxyServer;
  constructor(options: HttpServerOptions = {}) {
    this.options = { ...options };
    this.root = resolve(
      options.root ?? (existsSync("public") ? "public" : "."),
    );
    this.headers = { ...options.headers, "Accept-Ranges": "bytes" };
    for (const [key, value] of Object.entries(this.headers)) {
      http.validateHeaderName(key);
      http.validateHeaderValue(key, value);
    }
    if ((options.username !== undefined) !== (options.password !== undefined))
      throw new Error(
        "Basic authentication requires both username and password",
      );
    if (enabled(options.proxyAll, false) && !options.proxy)
      throw new Error("proxyAll option requires proxy");
    if (options.proxy || options.proxyConfig)
      this.proxy = createProxyServer({
        changeOrigin: true,
        ...options.proxyOptions,
        target: options.proxy,
      });
    const handler: http.RequestListener = (req, res) => {
      options.logFn?.(req, res);
      void this.dispatch(req, res).catch((error) => {
        options.logFn?.(req, res, error);
        if (res.headersSent) res.destroy(error);
        else {
          res.statusCode = error.status ?? 500;
          res.end(http.STATUS_CODES[res.statusCode]);
        }
      });
    };
    this.server = options.https
      ? https.createServer(options.https, handler)
      : http.createServer(handler);
    this.server.setTimeout(options.timeout ?? 120_000);
    if (options.websocket && this.proxy)
      this.server.on("upgrade", (req, socket, head) =>
        this.proxy!.ws(req, socket, head, (error) => socket.destroy(error)),
      );
    this.server.once("close", () => this.proxy?.close());
  }
  private async dispatch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    for (const [key, value] of Object.entries(this.headers))
      res.setHeader(key, value);
    const opts = this.options;
    if (opts.coop) {
      res.setHeader(
        "Cross-Origin-Opener-Policy",
        opts.coopHeader ?? "same-origin",
      );
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    }
    if (opts.cors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        `Origin, X-Requested-With, Content-Type, Accept, Range${opts.corsHeaders ? ", " + opts.corsHeaders : ""}`,
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    }
    if (opts.privateNetworkAccess)
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (opts.allowedHosts) {
      let host: string;
      try {
        host = new URL(`http://${req.headers.host}`).hostname;
      } catch {
        throw fail(403);
      }
      if (!opts.allowedHosts.includes(host)) throw fail(403);
    }
    if (opts.username !== undefined && opts.password !== undefined) {
      const credentials =
        req.headers.authorization?.match(/^Basic\s+(.+)$/i)?.[1];
      const raw = credentials
        ? Buffer.from(credentials, "base64").toString()
        : "";
      const index = raw.indexOf(":");
      const userOK = equal(raw.slice(0, index), opts.username);
      const passwordOK = equal(raw.slice(index + 1), opts.password);
      if (index < 0 || !userOK || !passwordOK) {
        res.setHeader("WWW-Authenticate", 'Basic realm=""');
        throw fail(401);
      }
    }
    for (const middleware of opts.before ?? []) {
      const proceed = await new Promise<boolean>((resolve, reject) => {
        const cleanup = () => {
          res.removeListener("finish", done);
          res.removeListener("close", done);
          res.removeListener("next", next);
        };
        const done = () => {
          cleanup();
          resolve(false);
        };
        const next = () => {
          cleanup();
          resolve(true);
        };
        res.once("finish", done);
        res.once("close", done);
        res.once("next", next);
        try {
          middleware(req, res, next);
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
      if (!proceed) return;
    }
    if (opts.cors && req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (opts.robots && (req.url ?? "").split("?")[0] === "/robots.txt") {
      const body =
        opts.robots === true
          ? "User-agent: *\nDisallow: /"
          : opts.robots.replace(/\\n/g, "\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if (opts.proxyConfig) {
      for (const [pattern, config] of Object.entries(opts.proxyConfig)) {
        if (minimatch(req.url ?? "/", pattern)) {
          for (const [search, replacement] of Object.entries(
            config.pathRewrite ?? {},
          ))
            req.url = req.url?.replace(new RegExp(search), replacement);
          this.proxyRequest(req, res, config);
          return;
        }
      }
    }
    if (enabled(opts.proxyAll, false)) {
      this.proxyRequest(req, res);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD, OPTIONS");
      throw fail(405);
    }
    try {
      await this.serve(req, res);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const status = (error as { status?: number }).status;
      if (status === 404 || code === "ENOENT" || code === "ENOTDIR") {
        if (opts.proxy) {
          this.proxyRequest(req, res);
          return;
        }
        try {
          await this.sendFile(req, res, resolve(this.root, "404.html"), 404);
          return;
        } catch {
          throw fail(404);
        }
      }
      if (code === "EACCES") throw fail(403);
      throw error;
    }
  }
  private proxyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    config?: ProxyOptions,
  ): void {
    this.proxy!.web(req, res, config ?? {}, (error) => {
      this.options.logFn?.(req, res, error);
      if (res.headersSent) res.destroy(error);
      else {
        res.writeHead(502);
        res.end("Bad Gateway");
      }
    });
  }
  private async safePath(path: string): Promise<string> {
    const [root, actual] = await Promise.all([
      realpath(this.root),
      realpath(path),
    ]);
    if (!contained(root, actual)) throw fail(403);
    return actual;
  }
  private async serve(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const raw = (req.url ?? "/").split("?")[0]!;
    let pathname: string;
    try {
      pathname = decodeURIComponent(raw);
    } catch {
      throw fail(400);
    }
    if (pathname.includes("\0") || pathname.includes("\\")) throw fail(400);
    if (pathname.split("/").includes("..")) throw fail(403);
    const base =
      "/" + (this.options.baseDir ?? "/").split("/").filter(Boolean).join("/");
    if (base !== "/" && pathname !== base && !pathname.startsWith(base + "/"))
      throw fail(404);
    if (base !== "/") pathname = pathname.slice(base.length) || "/";
    if (
      this.options.showDotfiles === false &&
      pathname.split("/").some((part) => part.startsWith(".") && part !== ".")
    )
      throw fail(404);
    let path = resolve(this.root, "." + pathname);
    if (!contained(this.root, path)) throw fail(403);
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const extension =
        this.options.ext === false
          ? undefined
          : typeof this.options.ext === "string"
            ? this.options.ext
            : "html";
      if (extname(path) || !extension) throw fail(404);
      path += "." + extension;
      info = await stat(path);
    }
    path = await this.safePath(path);
    if (info.isDirectory()) {
      if (!raw.endsWith("/")) {
        res.writeHead(301, {
          Location:
            raw +
            "/" +
            ((req.url ?? "").includes("?")
              ? "?" + (req.url ?? "").split("?").slice(1).join("?")
              : ""),
        });
        res.end();
        return;
      }
      if (enabled(this.options.autoIndex)) {
        try {
          await this.sendFile(req, res, resolve(path, "index.html"));
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (
        !this.options.dirOverrides404 &&
        existsSync(resolve(this.root, "404.html"))
      )
        throw fail(404);
      if (!enabled(this.options.showDir)) throw fail(403);
      const files = await readdir(path, { withFileTypes: true });
      files.sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      );
      const title = `Index of ${decodeURIComponent(raw)}`;
      const rows: string[] = [];
      for (const file of files) {
        if (this.options.showDotfiles === false && file.name.startsWith("."))
          continue;
        try {
          const actual = await this.safePath(resolve(path, file.name));
          const info = await stat(actual);
          const suffix = info.isDirectory() ? "/" : "";
          rows.push(
            `<li><a href="${encodeURIComponent(file.name)}${suffix}">${escapeHtml(file.name)}${suffix}</a> <small>${info.size} bytes${this.options.hidePermissions ? "" : ` · ${(info.mode & 0o777).toString(8)}`}</small></li>`,
          );
        } catch {
          /* Entries outside the served root and broken links stay hidden. */
        }
      }
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body><h1>${escapeHtml(title)}</h1><ul>${pathname !== "/" ? '<li><a href="../">../</a></li>' : ""}${rows.join("")}</ul></body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(html));
      res.end(req.method === "HEAD" ? undefined : html);
      return;
    }
    if (!info.isFile()) throw fail(404);
    await this.sendFile(req, res, path);
  }
  private async sendFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
    status = 200,
  ): Promise<void> {
    const original = path;
    const opts = this.options;
    await this.safePath(path);
    const originalInfo = await stat(path);
    if (!originalInfo.isFile()) throw fail(404);
    if (opts.brotli || opts.gzip) {
      res.setHeader("Vary", "Accept-Encoding");
      for (const [encoding, suffix, enabled] of [
        ["br", ".br", opts.brotli],
        ["gzip", ".gz", opts.gzip],
      ] as const) {
        if (
          enabled &&
          (opts.forceContentEncoding ||
            accepts(req.headers["accept-encoding"], encoding))
        ) {
          try {
            await this.safePath(path + suffix);
            const info = await stat(path + suffix);
            if (!info.isFile()) continue;
            path += suffix;
            res.setHeader("Content-Encoding", encoding);
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      }
    }
    const info = await stat(path);
    const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    const modified = info.mtime.toUTCString();
    const type =
      opts.mimetypes?.[extname(original).slice(1)] ??
      (lookup(original) || undefined) ??
      opts.contentType ??
      "application/octet-stream";
    res.setHeader("Content-Type", contentType(type) || type);
    res.setHeader("Last-Modified", modified);
    res.setHeader("ETag", etag);
    const cache = opts.cache ?? 3600;
    res.setHeader(
      "Cache-Control",
      cache === -1
        ? "no-cache, no-store, must-revalidate"
        : typeof cache === "number"
          ? `max-age=${cache}`
          : cache,
    );
    if (status === 200) {
      const noneMatch = req.headers["if-none-match"];
      const fresh = noneMatch
        ? noneMatch === "*" ||
          noneMatch
            .split(",")
            .some(
              (value) =>
                value.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""),
            )
        : req.headers["if-modified-since"] &&
          Date.parse(req.headers["if-modified-since"]) >=
            Math.floor(info.mtimeMs / 1000) * 1000;
      if (fresh) {
        res.writeHead(304);
        res.end();
        return;
      }
    }
    let start = 0;
    let end = info.size - 1;
    const range = req.headers.range;
    const ifRange =
      typeof req.headers["if-range"] === "string"
        ? req.headers["if-range"]
        : undefined;
    const useRange =
      range &&
      status === 200 &&
      (!ifRange ||
        (!ifRange.startsWith("W/") &&
          Date.parse(ifRange) >= Math.floor(info.mtimeMs / 1000) * 1000));
    if (useRange) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1]
          ? Number(match[1])
          : Math.max(0, info.size - Number(match[2]));
        end = match[1]
          ? match[2]
            ? Math.min(Number(match[2]), info.size - 1)
            : info.size - 1
          : info.size - 1;
        if (
          start > end ||
          start >= info.size ||
          (!match[1] && Number(match[2]) === 0)
        ) {
          res.setHeader("Content-Range", `bytes */${info.size}`);
          throw fail(416);
        }
        status = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
      } else if (range.startsWith("bytes=")) {
        res.setHeader("Content-Range", `bytes */${info.size}`);
        throw fail(416);
      }
    }
    res.setHeader("Content-Length", Math.max(0, end - start + 1));
    res.statusCode = status;
    if (req.method === "HEAD" || info.size === 0) {
      res.end();
      return;
    }
    try {
      await pipeline(createReadStream(path, { start, end }), res);
    } catch (error) {
      if (
        !req.destroyed &&
        (error as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE"
      )
        throw error;
    }
  }
  listen(port?: number, hostname?: string, callback?: () => void): this;
  listen(port: number, callback: () => void): this;
  listen(path: string, callback?: () => void): this;
  listen(
    options: import("node:net").ListenOptions,
    callback?: () => void,
  ): this;
  listen(
    portOrOptions: number | string | import("node:net").ListenOptions = 8080,
    hostnameOrCallback?: string | (() => void),
    callback?: () => void,
  ): this {
    if (typeof portOrOptions === "object")
      this.server.listen(
        portOrOptions,
        typeof hostnameOrCallback === "function"
          ? hostnameOrCallback
          : callback,
      );
    else if (typeof portOrOptions === "string")
      this.server.listen(
        portOrOptions,
        typeof hostnameOrCallback === "function"
          ? hostnameOrCallback
          : callback,
      );
    else if (typeof hostnameOrCallback === "function")
      this.server.listen(portOrOptions, hostnameOrCallback);
    else this.server.listen(portOrOptions, hostnameOrCallback, callback);
    return this;
  }
  close(callback?: (error?: Error) => void): this {
    this.proxy?.close();
    this.server.close(callback);
    return this;
  }
  address(): ReturnType<http.Server["address"]> {
    return this.server.address();
  }
}
export { HttpServer as HTTPServer };
export function createServer(options?: HttpServerOptions): HttpServer {
  return new HttpServer(options);
}
export default { createServer, HttpServer, HTTPServer: HttpServer };
