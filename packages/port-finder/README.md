# @yukino.js/port-finder

Find available TCP ports or unused Unix socket paths. Rewritten from `node-portfinder` using only Node's standard library.

```ts
import { getPort, getPorts, getSocket } from "@yukino.js/port-finder";
const port = await getPort({ port: 8080, stopPort: 9000, host: "127.0.0.1" });
const ports = await getPorts(3, { port: 9001 });
const socket = await getSocket({ path: "/tmp/my-app/server.sock" });
```

`getPort`, `getPorts` and `getSocket` return Promises when no callback is provided. They also accept `(options, (error, value) => {})` or just a callback (`getPorts(count, callback)`). Explicit `getPortPromise`, `getPortsPromise` and `getSocketPromise` aliases are available.

Port options: `port` (or `startPort`) starts the search, `stopPort` is an inclusive ceiling, and `host` binds a specific interface. Defaults are `basePort = 8000` and `highestPort = 65535`. Port 0 asks the operating system for an ephemeral port. Occupied and permission-denied ports are skipped; other errors propagate. `getPorts(count, options)` returns distinct ascending results; zero returns an empty array.

`setBasePort`, `setHighestPort` and `setBasePath` update exported live defaults. Base socket path defaults to `/tmp/portfinder`, producing `/tmp/portfinder.sock`. `getSocket({ path, mod })` creates missing parent directories (default mode 0755), checks existing filesystem entries without deleting them, and increments a filename suffix until unused.

Port probes close before resolving. Results are suggestions, not reservations; another process may bind between the probe and your listen call. Without `host`, the probe uses Node's wildcard binding instead of upstream's network-interface enumeration. Socket search checks the filesystem; it does not claim or remove a socket. The ESM default export exposes functions and read-only getters; use setters rather than assigning module properties.

## Development

Requires Node.js 24+ and pnpm. From the workspace root:

```sh
pnpm install
pnpm http:build
pnpm --filter @yukino.js/port-finder test
pnpm --filter @yukino.js/port-finder typecheck
pnpm --filter @yukino.js/port-finder lint
pnpm --filter @yukino.js/port-finder format:check
```

ESM JavaScript and source maps are bundled with Rolldown; TypeScript emits declarations. Tests use Vitest and real local listeners. See [NOTICE.md](./NOTICE.md) for upstream attribution.
