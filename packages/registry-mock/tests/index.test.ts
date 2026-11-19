import { afterEach, it, expect } from "vitest";
import { registryMock, type Registry } from "../src/index.js";
const registries: Registry[] = [];
async function start(maxBodySize?: number) {
  const registry = await registryMock({
    http: 0,
    host: "127.0.0.1",
    maxBodySize,
  });
  registries.push(registry);
  return {
    registry,
    url: `http://127.0.0.1:${(registry.address() as { port: number }).port}`,
  };
}
afterEach(async () => {
  await Promise.all(
    registries
      .splice(0)
      .map(
        (registry) =>
          new Promise<void>((resolve) => registry.close(() => resolve())),
      ),
  );
});
it("caches raw bodies, serves and clears cache", async () => {
  const { url } = await start();
  const payload = '{"hello":"world"}';
  expect(
    (await fetch(url + "/thing", { method: "POST", body: payload })).status,
  ).toBe(201);
  expect(
    await (
      await fetch(url + "/thing", { headers: { "x-fetch-cache": "1" } })
    ).text(),
  ).toBe(payload);
  expect(
    (await fetch(url + "/thing", { method: "POST", body: "new" })).status,
  ).toBe(200);
  expect(
    await (
      await fetch(url + "/thing", {
        headers: { "x-fetch-cache": "1", "x-clear-cache": "1" },
      })
    ).text(),
  ).toBe(payload);
  expect(
    (await fetch(url + "/thing", { headers: { "x-fetch-cache": "1" } })).status,
  ).toBe(404);
});
it("caches empty bodies and prototype-shaped paths safely", async () => {
  const { url } = await start();
  await fetch(url + "/__proto__", { method: "POST", body: "" });
  expect(
    (await fetch(url + "/__proto__", { headers: { "x-fetch-cache": "1" } }))
      .status,
  ).toBe(200);
  expect((await fetch(url + "/missing.tgz")).status).toBe(404);
});
it("accepts custom responses and falls back for malformed headers", async () => {
  const { url } = await start();
  const response = await fetch(url + "/a", {
    method: "POST",
    body: "ok",
    headers: {
      "x-send-response": JSON.stringify({ status: 202, body: { ok: true } }),
    },
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ ok: true });
  expect(
    (
      await fetch(url + "/b", {
        method: "POST",
        headers: { "x-send-response": "bad" },
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await fetch(url + "/c", {
        method: "POST",
        headers: { "x-send-response": '{"status":999}' },
      })
    ).status,
  ).toBe(201);
});
it.each(["/package", "/@scope%2Fpackage", "/@scope/package"])(
  "serves npm attachments for %s",
  async (path) => {
    const { url } = await start();
    const name = path.includes("@")
      ? "@scope/package-1.0.0.tgz"
      : "package-1.0.0.tgz";
    const body = JSON.stringify({
      "dist-tags": { latest: "1.0.0" },
      _attachments: {
        [name]: { data: Buffer.from("tarball bytes").toString("base64") },
      },
    });
    expect((await fetch(url + path, { method: "PUT", body })).status).toBe(201);
    expect(await (await fetch(url + path + "/-/" + name)).text()).toBe(
      "tarball bytes",
    );
  },
);
it("returns 400 for invalid publish data without corrupting the cache", async () => {
  const { url, registry } = await start();
  expect(
    (await fetch(url + "/package", { method: "PUT", body: "{" })).status,
  ).toBe(400);
  expect(registry.cache["/package"]).toBeUndefined();
});
it("enforces body limits", async () => {
  const { url } = await start(4);
  expect(
    (await fetch(url + "/a", { method: "POST", body: "12345" })).status,
  ).toBe(413);
});
it("reports occupied-port failures through callbacks", async () => {
  const { registry } = await start();
  const port = (registry.address() as { port: number }).port;
  const error = await new Promise<Error | null>((resolve) =>
    registryMock({ http: port, host: "127.0.0.1" }, (error) => resolve(error)),
  );
  expect(error).toMatchObject({ code: "EADDRINUSE" });
});
