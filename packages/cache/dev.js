#!/usr/bin/env node

// @ts-check
import { spawn } from "node:child_process";
import { copyFileSync, createWriteStream, mkdirSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

const DEMO_DIST = ".dist";
const ETCD_DATA_DIR = ".etcd";
const ETCD_LOG_PATH = join(ETCD_DATA_DIR, "etcd.log");
const ETCD_HOST = "127.0.0.1";
const ETCD_PORT = 2379;
const ETCD_START_TIMEOUT_MS = 30_000;
const PORT_PROBE_INTERVAL_MS = 500;
const SERVER_BOOT_DELAY_MS = 3_000;

const CACHE_PORTS = [8001, 8002, 8003];

const GRPC_GROUP = "user";

const TEST_CASES = [
  { addr: `127.0.0.1:${CACHE_PORTS[0]}`, key: "Alice", value: "1" },
  { addr: `127.0.0.1:${CACHE_PORTS[1]}`, key: "Bob", value: "2" },
  { addr: `127.0.0.1:${CACHE_PORTS[2]}`, key: "Yukino", value: "3" },
];

let etcdProcess = null;
const serverProcesses = [];
let cleanupDone = false;

async function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log("\n>>> cleanup");
  for (const proc of serverProcesses) {
    if (isAlive(proc)) proc.kill("SIGTERM");
  }
  if (etcdProcess && isAlive(etcdProcess)) {
    const target = etcdProcess;
    target.kill("SIGTERM");
    await new Promise((r) => target.once("exit", () => r(undefined)));
  }
  rmSync(ETCD_DATA_DIR, { recursive: true, force: true });
}

function isAlive(proc) {
  return proc.exitCode === null && proc.signalCode === null;
}

function probePort(host, port) {
  return new Promise((resolveFn) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolveFn(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolveFn(false);
    });
  });
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(host, port)) return true;
    await sleep(PORT_PROBE_INTERVAL_MS);
  }
  return false;
}

function runChild(cmd, args, options = {}) {
  return new Promise((resolveFn, reject) => {
    const child = spawn(cmd, [...args], options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveFn();
      } else {
        reject(new Error(`${cmd} exited with ${signal ?? code}`));
      }
    });
  });
}

async function ensureEtcd() {
  if (await probePort(ETCD_HOST, ETCD_PORT)) {
    console.log(`>>> reusing existing etcd on ${ETCD_HOST}:${ETCD_PORT}`);
    return;
  }
  rmSync(ETCD_DATA_DIR, { recursive: true, force: true });
  mkdirSync(ETCD_DATA_DIR, { recursive: true });
  console.log(`>>> starting local etcd (data dir: ${ETCD_DATA_DIR})`);
  const proc = spawn(
    "etcd",
    [
      "--data-dir",
      ETCD_DATA_DIR,
      "--listen-client-urls",
      `http://${ETCD_HOST}:${ETCD_PORT}`,
      "--advertise-client-urls",
      `http://${ETCD_HOST}:${ETCD_PORT}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const log = createWriteStream(ETCD_LOG_PATH, { flags: "a" });
  proc.stdout?.pipe(log);
  proc.stderr?.pipe(log);
  proc.once("error", (err) => {
    console.error("[etcd]", err);
  });
  etcdProcess = proc;
  console.log(`>>> waiting for etcd (pid ${proc.pid}) to accept connections`);
  if (!(await waitForPort(ETCD_HOST, ETCD_PORT, ETCD_START_TIMEOUT_MS))) {
    throw new Error(`etcd failed to start, see ${ETCD_LOG_PATH}`);
  }
}

async function compileDemo() {
  console.log(`>>> compiling demo entry into ${DEMO_DIST}`);
  rmSync(DEMO_DIST, { recursive: true, force: true });
  await runChild("./node_modules/.bin/tsc", ["--outDir", DEMO_DIST], {
    stdio: "inherit",
  });
  mkdirSync(join(DEMO_DIST, "proto"), { recursive: true });
  copyFileSync(
    "src/proto/yukino.proto",
    join(DEMO_DIST, "proto", "yukino.proto"),
  );
  copyFileSync(
    "src/proto/health.proto",
    join(DEMO_DIST, "proto", "health.proto"),
  );
}

function startCacheServer(port) {
  const proc = spawn(
    "node",
    [join(DEMO_DIST, "main.js"), "--port", String(port)],
    {
      stdio: "inherit",
    },
  );
  proc.once("error", (err) => {
    console.error(`[server :${port}]`, err);
  });
  serverProcesses.push(proc);
  return proc;
}

async function runGrpcTests() {
  const clientUrl = pathToFileURL(resolve(DEMO_DIST, "client.js")).href;
  const mod = await import(clientUrl);
  const { Client } = mod;
  await Promise.all(
    TEST_CASES.map(async ({ addr, key, value }) => {
      const client = new Client(addr);
      try {
        await client.set(GRPC_GROUP, key, Buffer.from(value));
        const got = await client.get(GRPC_GROUP, key);
        console.log("OK  ", addr, key, `set=${value}`, `get=${got.toString()}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log("FAIL", addr, key, "=>", msg);
      } finally {
        await client.close();
      }
    }),
  );
}

function registerSignalHandlers() {
  const finalize = async (reason) => {
    try {
      await cleanup();
    } finally {
      process.exit(reason === "uncaughtException" ? 1 : 0);
    }
  };
  process.on("SIGINT", () => {
    void finalize("SIGINT");
  });
  process.on("SIGTERM", () => {
    void finalize("SIGTERM");
  });
  process.on("uncaughtException", (err) => {
    console.error("[bootstrap] uncaughtException:", err);
    void finalize("uncaughtException");
  });
  process.on("unhandledRejection", (err) => {
    console.error("[bootstrap] unhandledRejection:", err);
    void finalize("uncaughtException");
  });
}

async function main() {
  registerSignalHandlers();
  await ensureEtcd();
  await compileDemo();
  console.log(
    `>>> starting cache servers on ${CACHE_PORTS.map((p) => `:${p}`).join(" ")}`,
  );
  for (const port of CACHE_PORTS) startCacheServer(port);
  await sleep(SERVER_BOOT_DELAY_MS);
  console.log(">>> start grpc test");
  await runGrpcTests();
  console.log("\n>>> demo running, ctrl-c to stop servers");
  await new Promise(() => undefined);
}

main().catch(async (err) => {
  console.error("[bootstrap]", err);
  await cleanup();
  process.exit(1);
});
