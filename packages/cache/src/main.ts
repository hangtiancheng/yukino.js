import { Group, newGroup } from "./group.js";
import { Server } from "./server.js";
import { ClientPicker } from "./client-picker.js";
import { getLocalIP } from "./utils.js";

const GROUP_NAME = "user";
const MAX_BYTES = 2 << 10;
const DEFAULT_SVC_NAME = "yukino_cache";

const database: Record<string, string> = {
  Alice: "1",
  Bob: "2",
  Yukino: "3",
};

function createGroup(): Group {
  return newGroup(
    GROUP_NAME,
    MAX_BYTES,
    async (_ctx: AbortSignal, key: string): Promise<Buffer> => {
      console.log("[database] search key", key);
      if (key in database) {
        return Buffer.from(database[key]);
      }
      throw new Error(`key ${key} not found`);
    },
  );
}

async function startCacheServer(
  bindAddr: string,
  advertiseAddr: string,
  group: Group,
): Promise<void> {
  const server = new Server(bindAddr, DEFAULT_SVC_NAME, { advertiseAddr });
  await server.start();

  const picker = new ClientPicker(advertiseAddr, {
    serviceName: DEFAULT_SVC_NAME,
  });
  await picker.start();
  group.registerPeers(picker);
  picker.printPeers();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let port = 50051;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p" || args[i] === "--port") {
      port = parseInt(args[i + 1]) || 50051;
      i++;
    }
  }

  let host: string;
  try {
    host = getLocalIP();
  } catch {
    host = "127.0.0.1";
  }

  const bindAddr = `0.0.0.0:${port}`;
  const advertiseAddr = `${host}:${port}`;
  const group = createGroup();
  await startCacheServer(bindAddr, advertiseAddr, group);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
