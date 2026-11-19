import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as http2 from "node:http2";
import { fileURLToPath } from "node:url";
import { createServers, type Server, type Servers } from "../src/index.js";
const root = fileURLToPath(new URL("./fixtures", import.meta.url));
const handler: http.RequestListener = (_req, res) => res.end("hello");
const close = async (servers: Servers) => {
  await Promise.all(
    Object.values(servers)
      .flat()
      .map(
        (server: Server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
};
it("starts shared HTTP handlers on multiple listeners", async () => {
  const servers = await createServers({
    http: [0, { port: 0 }],
    host: "127.0.0.1",
    handler,
    timeout: 1500,
    keepAliveTimeout: 0,
  });
  try {
    const list = servers.http as http.Server[];
    expect(list).toHaveLength(2);
    for (const server of list) {
      expect(server.timeout).toBe(1500);
      expect(server.keepAliveTimeout).toBe(0);
      expect(
        await (
          await fetch(
            `http://127.0.0.1:${(server.address() as { port: number }).port}`,
          )
        ).text(),
      ).toBe("hello");
    }
  } finally {
    await close(servers);
  }
});
it("supports callback API and per-listener handlers", async () => {
  const servers = await new Promise<Servers>((resolve, reject) => {
    void createServers(
      { http: { port: 0, handler: (_req, res) => res.end("custom") } },
      (error, value) => (error ? reject(error) : resolve(value!)),
    );
  });
  try {
    expect(servers.http).toBeDefined();
  } finally {
    await close(servers);
  }
});
it("validates missing protocols, handlers and invalid ports", async () => {
  await expect(createServers({ handler })).rejects.toThrow("required options");
  await expect(createServers({ http: 0 })).rejects.toThrow("handler");
  await expect(createServers({ http: -1, handler })).rejects.toThrow(
    "Invalid port",
  );
});
it("rolls back listeners after a bind failure", async () => {
  const occupied = http.createServer(handler);
  await new Promise<void>((resolve) =>
    occupied.listen(0, "127.0.0.1", resolve),
  );
  const port = (occupied.address() as { port: number }).port;
  try {
    await expect(
      createServers({ http: [0, port], host: "127.0.0.1", handler }),
    ).rejects.toThrow("EADDRINUSE");
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
it("loads TLS certificates from relative paths and supports HTTPS", async () => {
  const servers = await createServers({
    https: { port: 0, root, key: "key.pem", cert: ["cert.pem"] },
    handler,
  });
  try {
    const server = servers.https as https.Server;
    const value = await new Promise<string>((resolve, reject) => {
      https
        .get(
          {
            host: "localhost",
            port: (server.address() as { port: number }).port,
            rejectUnauthorized: false,
          },
          (res) => {
            let body = "";
            res.on("data", (data) => (body += data));
            res.on("end", () => resolve(body));
          },
        )
        .on("error", reject);
    });
    expect(value).toBe("hello");
  } finally {
    await close(servers);
  }
});
it("supports HTTP/2 secure servers", async () => {
  const servers = await createServers({
    http2: { port: 0, root, key: "key.pem", cert: "cert.pem" },
    handler,
  });
  const server = servers.http2 as http2.Http2SecureServer;
  const client = http2.connect(
    `https://localhost:${(server.address() as { port: number }).port}`,
    { rejectUnauthorized: false },
  );
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const request = client.request({ ":path": "/" });
      let data = "";
      request.on("data", (chunk) => (data += chunk));
      request.once("end", () => resolve(data));
      request.once("error", reject);
      request.end();
    });
    expect(body).toBe("hello");
  } finally {
    await new Promise<void>((resolve) => {
      client.close(resolve);
    });
    await close(servers);
  }
});
it("accepts inline PEM buffers", async () => {
  const key = await readFile(root + "/key.pem");
  const cert = await readFile(root + "/cert.pem");
  const servers = await createServers({
    https: { port: 0, key, cert },
    handler,
  });
  await close(servers);
});

it("prepares SNI contexts for wildcard hostnames", async () => {
  const servers = await createServers({
    https: {
      port: 0,
      root,
      key: "key.pem",
      cert: "cert.pem",
      sni: { "*.example.test": { key: "key.pem", cert: "cert.pem" } },
    },
    handler,
  });
  const port = ((servers.https as https.Server).address() as { port: number })
    .port;
  try {
    for (const servername of ["example.test", "deep.sub.example.test"]) {
      const body = await new Promise<string>((resolve, reject) => {
        https
          .get(
            { host: "localhost", port, servername, rejectUnauthorized: false },
            (response) => {
              let data = "";
              response.on("data", (chunk) => (data += chunk));
              response.on("end", () => resolve(data));
            },
          )
          .on("error", reject);
      });
      expect(body).toBe("hello");
    }
  } finally {
    await close(servers);
  }
});
