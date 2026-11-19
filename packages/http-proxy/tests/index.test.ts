import { afterEach, it, expect } from "vitest";
import * as http from "node:http";
import * as https from "node:https";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { Readable } from "node:stream";
import {
  createProxyServer,
  type ProxyServer,
  type ProxyOptions,
} from "../src/index.js";
const servers: http.Server[] = [];
const proxies: ProxyServer[] = [];
async function listen(server: http.Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function proxy(target: string, options: ProxyOptions = {}) {
  const p = createProxyServer({ target, ...options });
  proxies.push(p);
  return {
    p,
    url: await listen(
      http.createServer((req, res) =>
        p.web(req, res, (error) => {
          res.statusCode = 502;
          res.end(error.message);
        }),
      ),
    ),
  };
}
afterEach(async () => {
  for (const proxy of proxies.splice(0)) proxy.close();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
it("streams request bodies, target paths, queries, custom headers and events", async () => {
  const target = await listen(
    http.createServer(async (req, res) => {
      let body = "";
      for await (const data of req) body += data;
      res.setHeader("X-Target", "yes");
      res.end(
        JSON.stringify({
          url: req.url,
          method: req.method,
          body,
          headers: req.headers,
        }),
      );
    }),
  );
  const { url, p } = await proxy(target + "/base", {
    changeOrigin: true,
    xfwd: true,
    headers: { "x-added": "value" },
  });
  let events = 0;
  p.on("proxyReq", (request) => {
    request.setHeader("x-event", "yes");
    events++;
  });
  p.on("proxyRes", () => events++);
  const response = await fetch(url + "/path?q=1", {
    method: "POST",
    body: "streamed body",
  });
  const body = await response.json();
  expect(body).toMatchObject({
    url: "/base/path?q=1",
    method: "POST",
    body: "streamed body",
    headers: {
      host: new URL(target).host,
      "x-added": "value",
      "x-event": "yes",
      "x-forwarded-proto": "http",
    },
  });
  expect(events).toBe(2);
  expect(response.headers.get("x-target")).toBe("yes");
});
it("supports per-request options and restreaming consumed bodies", async () => {
  const target = await listen(
    http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      res.end(req.url + " " + body);
    }),
  );
  const p = createProxyServer();
  proxies.push(p);
  const url = await listen(
    http.createServer((req, res) => {
      req.resume();
      req.once("end", () =>
        p.web(req, res, {
          target: target + "/fixed",
          ignorePath: true,
          buffer: Readable.from("hello"),
          headers: { "content-length": "5" },
        }),
      );
    }),
  );
  expect(
    await (
      await fetch(url + "/ignored", { method: "POST", body: "hello" })
    ).text(),
  ).toBe("/fixed hello");
});
it("rewrites cookies and redirect locations", async () => {
  const target = await listen(
    http.createServer((_req, res) => {
      res.writeHead(302, {
        location: target + "/landing",
        "set-cookie": ["session=1; Domain=old.test; Path=/old", "other=2"],
      });
      res.end();
    }),
  );
  const { url } = await proxy(target, {
    hostRewrite: "new.test",
    protocolRewrite: "https",
    cookieDomainRewrite: "",
    cookiePathRewrite: "/",
  });
  const response = await fetch(url, { redirect: "manual" });
  expect(response.headers.get("location")).toBe("https://new.test/landing");
  expect(response.headers.getSetCookie()).toEqual([
    "session=1; Path=/",
    "other=2",
  ]);
});
it("can self-handle responses", async () => {
  const target = await listen(
    http.createServer((_req, res) => res.end("original")),
  );
  const { url, p } = await proxy(target, { selfHandleResponse: true });
  p.on("proxyRes", (response, _req, res) => {
    response.resume();
    response.once("end", () => res.end("changed"));
  });
  expect(await (await fetch(url)).text()).toBe("changed");
});
it("follows redirects when requested", async () => {
  const target = await listen(
    http.createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(302, { location: "/done" });
        res.end();
      } else res.end("redirected");
    }),
  );
  const { url } = await proxy(target, { followRedirects: true });
  expect(await (await fetch(url)).text()).toBe("redirected");
});
it("reports connection failures and timeouts once", async () => {
  const dead = http.createServer();
  const target = await listen(dead);
  await new Promise<void>((resolve) => dead.close(() => resolve()));
  const { url } = await proxy(target);
  expect((await fetch(url)).status).toBe(502);
  const slow = await listen(http.createServer(() => {}));
  const timed = await proxy(slow, { proxyTimeout: 20 });
  expect((await fetch(timed.url)).status).toBe(502);
});
it("supports HTTPS targets with explicit certificate policy", async () => {
  const key = await readFile(
    new URL("../../create-servers/tests/fixtures/key.pem", import.meta.url),
  );
  const cert = await readFile(
    new URL("../../create-servers/tests/fixtures/cert.pem", import.meta.url),
  );
  const target = (
    await listen(
      https.createServer({ key, cert }, (_req, res) => res.end("secure")),
    )
  ).replace("http:", "https:");
  const { url } = await proxy(target, { secure: false });
  expect(await (await fetch(url)).text()).toBe("secure");
  const strict = await proxy(target);
  expect((await fetch(strict.url)).status).toBe(502);
});
it("runs named passes before streaming", async () => {
  const target = await listen(
    http.createServer((req, res) => res.end(req.headers["x-pass"])),
  );
  const { url, p } = await proxy(target);
  p.before("web", "stream", function add(req) {
    req.headers["x-pass"] = "added";
  });
  expect(await (await fetch(url)).text()).toBe("added");
  expect(() => p.before("web", "unknown", () => {})).toThrow("No such pass");
});
it("tunnels WebSocket upgrades and bytes in both directions", async () => {
  const upstream = http.createServer();
  upstream.on("upgrade", (_req, socket, head) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    if (head.length) socket.write(head);
    socket.on("data", (data) => socket.write(data));
    socket.on("end", () => socket.end());
  });
  const target = await listen(upstream);
  const p = createProxyServer({ target, ws: true });
  proxies.push(p);
  p.listen(0, "127.0.0.1");
  await once(p._server!, "listening");
  const socket = connect(
    (p._server!.address() as { port: number }).port,
    "127.0.0.1",
  );
  try {
    await once(socket, "connect");
    socket.write(
      "GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    const [header] = await once(socket, "data");
    expect(header.toString()).toContain("101 Switching Protocols");
    socket.write("ping bytes");
    const [echo] = await once(socket, "data");
    expect(echo.toString()).toBe("ping bytes");
  } finally {
    socket.destroy();
  }
});
