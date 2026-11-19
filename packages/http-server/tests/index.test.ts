import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as http from "node:http";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createServer,
  type HttpServer,
  type HttpServerOptions,
} from "../src/index.js";
let root: string;
const servers: HttpServer[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "static-"));
  await writeFile(join(root, "index.html"), "<h1>home</h1>");
  await writeFile(join(root, "hello.txt"), "0123456789");
  await writeFile(join(root, ".hidden"), "hidden");
  await mkdir(join(root, "directory"));
  await writeFile(join(root, "directory", "<script>.txt"), "safe");
});
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await rm(root, { recursive: true, force: true });
});
async function start(options: HttpServerOptions = {}) {
  const server = createServer({ root, ...options });
  servers.push(server);
  server.server.listen(0, "127.0.0.1");
  await once(server.server, "listening");
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  };
}
async function raw(
  url: string,
  path: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.get(url + path, { headers }, (res) => {
      let body = "";
      res.on("data", (data) => (body += data));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    request.on("error", reject);
  });
}
it("serves index files, MIME types, extension fallback and HEAD", async () => {
  await writeFile(join(root, "page.html"), "page");
  const { url } = await start();
  expect(await (await fetch(url)).text()).toBe("<h1>home</h1>");
  expect(await (await fetch(url + "/page")).text()).toBe("page");
  const file = await fetch(url + "/hello.txt");
  expect(file.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(file.headers.get("cache-control")).toBe("max-age=3600");
  const head = await fetch(url + "/hello.txt", { method: "HEAD" });
  expect(head.headers.get("content-length")).toBe("10");
  expect(await head.text()).toBe("");
});
it("serves empty files and 404 fallback pages", async () => {
  await writeFile(join(root, "empty"), "");
  await writeFile(join(root, "404.html"), "custom missing");
  const { url } = await start();
  expect((await fetch(url + "/empty")).status).toBe(200);
  const missing = await fetch(url + "/missing");
  expect(missing.status).toBe(404);
  expect(await missing.text()).toBe("custom missing");
});
it("supports byte ranges, suffix ranges and unsatisfiable ranges", async () => {
  const { url } = await start();
  const range = await fetch(url + "/hello.txt", {
    headers: { range: "bytes=2-5" },
  });
  expect(range.status).toBe(206);
  expect(range.headers.get("content-range")).toBe("bytes 2-5/10");
  expect(await range.text()).toBe("2345");
  expect(
    await (
      await fetch(url + "/hello.txt", { headers: { range: "bytes=-3" } })
    ).text(),
  ).toBe("789");
  const bad = await fetch(url + "/hello.txt", {
    headers: { range: "bytes=50-60" },
  });
  expect(bad.status).toBe(416);
  expect(bad.headers.get("content-range")).toBe("bytes */10");
  expect(
    (
      await fetch(url + "/hello.txt", {
        headers: {
          range: "bytes=1-2",
          "if-range": "Thu, 01 Jan 1970 00:00:00 GMT",
        },
      })
    ).status,
  ).toBe(200);
});
it("returns conditional 304 responses", async () => {
  const { url } = await start();
  const first = await fetch(url + "/hello.txt");
  expect(
    (
      await fetch(url + "/hello.txt", {
        headers: { "if-none-match": first.headers.get("etag")! },
      })
    ).status,
  ).toBe(304);
  expect(
    (
      await fetch(url + "/hello.txt", {
        headers: { "if-modified-since": first.headers.get("last-modified")! },
      })
    ).status,
  ).toBe(304);
});
it("redirects directory requests and escapes directory entries", async () => {
  const { url } = await start();
  const redirect = await fetch(url + "/directory?q=1", { redirect: "manual" });
  expect(redirect.status).toBe(301);
  expect(redirect.headers.get("location")).toBe("/directory/?q=1");
  const text = await (await fetch(url + "/directory/")).text();
  expect(text).toContain("&lt;script&gt;.txt");
  expect(text).toContain("%3Cscript%3E.txt");
});
it("blocks encoded traversal, malformed paths and outside symlinks", async () => {
  await symlink(tmpdir(), join(root, "outside"));
  const { url } = await start();
  expect((await raw(url, "/%2e%2e%2fsecret")).status).toBe(403);
  expect((await raw(url, "/%00")).status).toBe(400);
  expect((await raw(url, "/%FF")).status).toBe(400);
  expect((await fetch(url + "/outside/")).status).toBe(403);
});
it("hides dotfiles and supports base paths", async () => {
  const { url } = await start({ showDotfiles: false, baseDir: "/files" });
  expect((await fetch(url + "/hello.txt")).status).toBe(404);
  expect((await fetch(url + "/files/.hidden")).status).toBe(404);
  expect(await (await fetch(url + "/files/hello.txt")).text()).toBe(
    "0123456789",
  );
});
it("supports CORS preflights, COOP, robots, and custom headers", async () => {
  const { url } = await start({
    cors: true,
    corsHeaders: "X-Custom",
    coop: true,
    robots: true,
    headers: { "X-Test": "yes" },
    cache: -1,
  });
  const preflight = await fetch(url, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  expect(preflight.headers.get("access-control-allow-headers")).toContain(
    "X-Custom",
  );
  const file = await fetch(url + "/hello.txt");
  expect(file.headers.get("cache-control")).toContain("no-store");
  expect(file.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  expect(file.headers.get("x-test")).toBe("yes");
  expect(await (await fetch(url + "/robots.txt")).text()).toContain(
    "Disallow: /",
  );
});
it("checks basic authentication and permitted hosts", async () => {
  const { url } = await start({
    username: "user",
    password: "pass",
    allowedHosts: ["127.0.0.1"],
  });
  expect((await fetch(url)).status).toBe(401);
  const auth = {
    authorization: "Basic " + Buffer.from("user:pass").toString("base64"),
  };
  expect((await fetch(url, { headers: auth })).status).toBe(200);
  expect((await raw(url, "/", { ...auth, host: "evil.test" })).status).toBe(
    403,
  );
});
it("serves precompressed files with encoding negotiation", async () => {
  await writeFile(join(root, "hello.txt.gz"), gzipSync("0123456789"));
  await writeFile(join(root, "hello.txt.br"), brotliCompressSync("0123456789"));
  const { url } = await start({ gzip: true, brotli: true });
  const gzip = await fetch(url + "/hello.txt", {
    headers: { "accept-encoding": "gzip" },
  });
  expect(gzip.headers.get("content-encoding")).toBe("gzip");
  expect(await gzip.text()).toBe("0123456789");
  const br = await fetch(url + "/hello.txt", {
    headers: { "accept-encoding": "br,gzip" },
  });
  expect(br.headers.get("content-encoding")).toBe("br");
  expect(await br.text()).toBe("0123456789");
  const plain = await fetch(url + "/hello.txt", {
    headers: { "accept-encoding": "br;q=0,gzip;q=0" },
  });
  expect(plain.headers.get("content-encoding")).toBeNull();
});
it("runs middleware and supports proxy fallback with path rewriting", async () => {
  const target = http.createServer((req, res) =>
    res.end("upstream " + req.url),
  );
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const proxy = `http://127.0.0.1:${(target.address() as { port: number }).port}`;
  try {
    const { url } = await start({
      proxy,
      before: [
        (_req, res, next) => {
          res.setHeader("x-before", "yes");
          next();
        },
      ],
      proxyConfig: {
        "/api/**": { target: proxy, pathRewrite: { "^/api": "/v1" } },
      },
    });
    expect(await (await fetch(url + "/hello.txt")).text()).toBe("0123456789");
    const missing = await fetch(url + "/missing");
    expect(missing.headers.get("x-before")).toBe("yes");
    expect(await missing.text()).toBe("upstream /missing");
    expect(await (await fetch(url + "/api/users")).text()).toBe(
      "upstream /v1/users",
    );
  } finally {
    target.closeAllConnections();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});
it("validates headers, authentication and proxy configuration", () => {
  expect(() =>
    createServer({ headers: { "x-test": "bad\r\nvalue" } }),
  ).toThrow();
  expect(() => createServer({ username: "only" })).toThrow("both");
  expect(() => createServer({ proxyAll: true })).toThrow("requires proxy");
});
it("ships a runnable CLI with help and errors", async () => {
  const run = promisify(execFile);
  const file = new URL("../dist/cli.js", import.meta.url).pathname;
  expect((await run(process.execPath, [file, "--help"])).stdout).toContain(
    "Usage: http-server",
  );
  await expect(
    run(process.execPath, [file, "--invalid-option"]),
  ).rejects.toMatchObject({ code: 1 });
});

it("runs the CLI with legacy flags and shuts down on SIGTERM", async () => {
  const { spawn } = await import("node:child_process");
  const file = new URL("../dist/cli.js", import.meta.url).pathname;
  const child = spawn(
    process.execPath,
    [
      file,
      root,
      "-p",
      "0",
      "-a",
      "127.0.0.1",
      "-c-1",
      "--cors=X-Example",
      "-d",
      "-i",
      "false",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = once(child, "exit");
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/ at (http:\/\/\S+)/);
        if (match) resolve(match[1]!);
      });
      child.stderr.on("data", (chunk) => reject(new Error(chunk.toString())));
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`CLI exited: ${code}`)));
    });
    const response = await fetch(url + "/hello.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "X-Example",
    );
    expect(await response.text()).toBe("0123456789");
  } finally {
    child.kill("SIGTERM");
    await exited;
  }
});
