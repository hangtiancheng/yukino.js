# @yukino.js/http-server

Static HTTP/HTTPS file server and `http-server` CLI, rewritten from http-party/http-server. Uses the workspace HTTP proxy and port finder.

```ts
import { createServer } from "@yukino.js/http-server";
const server = createServer({ root: "./public", cache: -1, cors: true });
server.listen(8080, "127.0.0.1", () => console.log(server.address()));
// server.close();
```

```sh
pnpm --filter @yukino.js/http-server exec http-server ./public -p 8080 --cors -c-1
pnpm --filter @yukino.js/http-server exec http-server --help
```

`createServer(options)` returns `HttpServer` (`HTTPServer` alias) with `server`, `root`, `headers`, `listen`, `address` and `close`. It uses Node HTTP servers directly. The default root is `./public` when present, otherwise the current directory.

| Options                                                             | Behavior                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `root`, `baseDir`                                                   | Filesystem root and URL mount prefix.                                                                                      |
| `autoIndex`, `showDir`                                              | Serve index.html and escaped directory listings (default true; false or 'false' disables).                                 |
| `dirOverrides404`                                                   | Allow directory listings to take precedence over root 404.html.                                                            |
| `showDotfiles`, `hidePermissions`                                   | Dotfile visibility (default visible), directory permission display.                                                        |
| `ext`                                                               | Fallback extension (default html; false disables).                                                                         |
| `cache`                                                             | Seconds (default 3600), -1 disables caching, or a Cache-Control string.                                                    |
| `gzip`, `brotli`, `forceContentEncoding`                            | Serve precompressed .gz/.br siblings. Brotli takes precedence; encoding q=0 is respected. No runtime compression.          |
| `headers`, `contentType`, `mimetypes`                               | Custom response headers, fallback MIME type, extension-to-MIME mapping. Headers are validated.                             |
| `username`, `password`, `allowedHosts`                              | Basic authentication and exact hostname allowlist. Both credentials are required together.                                 |
| `cors`, `corsHeaders`, `coop`, `coopHeader`, `privateNetworkAccess` | Cross-origin and isolation headers, with CORS preflight handling.                                                          |
| `robots`                                                            | true supplies a deny-all robots.txt; a string supplies custom content.                                                     |
| `https`, `timeout`                                                  | Native HTTPS options (PEM contents/Buffers), socket timeout in milliseconds (default 120000).                              |
| `proxy`, `proxyOptions`, `proxyAll`, `websocket`                    | Fallback upstream URL, proxy options, proxy every route, WebSocket upgrades.                                               |
| `proxyConfig`                                                       | Glob-to-proxy-options map; first match wins. Each entry may include regex `pathRewrite` mappings.                          |
| `before`, `logFn`                                                   | Middleware array `(req, res, next)` and optional request/error logger. Legacy `res.emit('next')` also advances middleware. |

Supports HEAD, single byte and suffix ranges, Last-Modified/ETag conditional requests, directory redirects and a root 404.html fallback. Non-GET/HEAD static requests return 405. Symlinks resolving outside the root and encoded traversal are rejected. Directory names are HTML-escaped.

The CLI reads PORT, accepts port 0 to search from 8080, and reads NODE_HTTP_SERVER_SSL_PASSPHRASE for encrypted TLS keys. CLI timeout is in seconds; the library uses milliseconds. Run `--help` for supported arguments. It uses native argument parsing rather than legacy minimist; unsupported flags fail explicitly. The low-level upstream `lib/core` APIs and union-specific response objects are not exported. Custom MIME types in the library use a mapping rather than a path to a .types file. Native Node TLS defaults apply.

## Development

Requires Node.js 24+ and pnpm. From the workspace root:

```sh
pnpm install
pnpm http:build
pnpm --filter @yukino.js/http-server test
pnpm --filter @yukino.js/http-server typecheck
pnpm --filter @yukino.js/http-server lint
pnpm --filter @yukino.js/http-server format:check
```

ESM JavaScript and source maps are bundled with Rolldown; TypeScript emits declarations. Tests use Vitest and real local listeners. See [NOTICE.md](./NOTICE.md) for upstream attribution.
