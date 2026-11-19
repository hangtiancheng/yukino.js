import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPort,
  getPorts,
  getSocket,
  setBasePort,
  setHighestPort,
  setBasePath,
  basePort,
  highestPort,
  basePath,
} from "../src/index.js";

describe("port finder", () => {
  it("finds a bindable ephemeral port", async () => {
    const port = await getPort({ port: 0 });
    expect(port).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => resolve());
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("skips occupied ports and reports exhaustion", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    try {
      await expect(
        getPort({ port, stopPort: port, host: "127.0.0.1" }),
      ).rejects.toThrow("No open ports");
      expect(await getPort({ port, host: "127.0.0.1" })).toBeGreaterThan(port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("returns distinct ascending ports", async () => {
    const ports = await getPorts(3, { port: 19000, host: "127.0.0.1" });
    expect(new Set(ports).size).toBe(3);
    expect(ports).toEqual([...ports].sort((a, b) => a - b));
  });
  it("supports callbacks", async () => {
    const port = await new Promise<number | undefined>((resolve, reject) =>
      getPort({ port: 0 }, (err, port) => (err ? reject(err) : resolve(port))),
    );
    expect(port).toBeGreaterThan(0);
  });
  it("validates search bounds and counts", async () => {
    await expect(getPort({ port: -1 })).rejects.toThrow(RangeError);
    await expect(getPort({ port: 1.5 })).rejects.toThrow(RangeError);
    await expect(getPort({ port: 9000, stopPort: 8000 })).rejects.toThrow(
      RangeError,
    );
    await expect(getPorts(-1)).rejects.toThrow(RangeError);
    expect(await getPorts(0)).toEqual([]);
  });
  it("updates exported defaults through setters", () => {
    const previous = [basePort, highestPort, basePath] as const;
    try {
      setBasePort(12000);
      setHighestPort(13000);
      setBasePath("/tmp/custom");
      expect(basePort).toBe(12000);
      expect(highestPort).toBe(13000);
      expect(basePath).toBe("/tmp/custom");
      expect(() => setBasePort(65536)).toThrow(RangeError);
    } finally {
      setBasePort(previous[0]);
      setHighestPort(previous[1]);
      setBasePath(previous[2]);
    }
  });
  it("finds unused socket filenames without deleting existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "ports-"));
    try {
      const path = join(root, "nested/test.sock");
      expect(await getSocket({ path })).toBe(path);
      await writeFile(path, "existing");
      expect(await getSocket({ path })).toBe(join(root, "nested/test1.sock"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
