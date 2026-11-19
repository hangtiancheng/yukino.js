# @yukino.js/registry-mock

A mock npm registry and generic HTTP request cache, rewritten from `registry-mock` with native streams.

```ts
import registryMock from "@yukino.js/registry-mock";
const registry = await registryMock({ http: 0, host: "127.0.0.1" });
console.log(registry.address());
registry.on("cached", (request) => console.log(request.method, request.url));
// registry.close();
```

`registryMock(options)` / `createRegistry(options)` returns a Promise. The callback form `registryMock(options, (error, registry) => {})` is supported. `Registry` is also a named export and a property of the default factory. `new Registry(options)` creates an unbound instance; `listen(callback)` starts it.

| Option           | Default                 |
| ---------------- | ----------------------- |
| `http` or `port` | 0 (ephemeral)           |
| `host`           | Node's wildcard binding |
| `maxBodySize`    | 64 MiB                  |

`server`, `cache`, `port`, `address()`, `listen(callback)` and `close(callback)` expose lifecycle and inspection. `port` is the configured port; use `address().port` to inspect an ephemeral listener. Cache entries are raw Buffers in a null-prototype record. The `cached` event carries `{ method, url, headers, body }` after successful caching.

- Requests with `X-FETCH-CACHE`, and URLs containing `.tgz`, fetch a cached body or return JSON 404. `X-CLEAR-CACHE` deletes a hit after it is served.
- Other requests store the raw body keyed by request URL. A previously cached URL returns 200 and keeps the first body.
- `X-SEND-RESPONSE: {"status":202,"body":{"ok":true}}` controls the response. Default is 201 with a cache message. Invalid headers use the default.
- npm `PUT /package` and scoped package paths extract `_attachments` base64 tarballs into `/<package>/-/<attachment-name>`. Invalid JSON or attachment structures return 400 without poisoning the cache. Tarballs are served as application/octet-stream.
- Oversized bodies return 413. Startup errors reach the Promise rejection or callback.

```sh
PORT=3676 pnpm --filter @yukino.js/registry-mock exec npm-registry-echo
```

The CLI logs cached requests after collection. DUMP_CACHE or X-DUMP-CACHE also prints the current cache. It uses the cache event rather than making a racing second HTTP request. This is a test server with an in-memory cache, not a persistent npm registry.

## Development

Requires Node.js 24+ and pnpm. From the workspace root:

```sh
pnpm install
pnpm http:build
pnpm --filter @yukino.js/registry-mock test
pnpm --filter @yukino.js/registry-mock typecheck
pnpm --filter @yukino.js/registry-mock lint
pnpm --filter @yukino.js/registry-mock format:check
```

ESM JavaScript and source maps are bundled with Rolldown; TypeScript emits declarations. Tests use Vitest and real local listeners. See [NOTICE.md](./NOTICE.md) for upstream attribution.
