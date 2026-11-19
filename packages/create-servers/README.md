# @yukino.js/create-servers

Create HTTP, HTTPS and secure HTTP/2 servers with a shared request handler. A TypeScript rewrite of `create-servers` using Node's built-in server and TLS APIs.

```ts
import createServers from "@yukino.js/create-servers";

const servers = await createServers({
  host: "127.0.0.1",
  handler: (_request, response) => response.end("Hello"),
  http: [8080, { port: 8081, keepAliveTimeout: 0 }],
  https: { port: 8443, root: "./tls", key: "key.pem", cert: "cert.pem" },
});
for (const server of Object.values(servers).flat()) server.close();
```

`createServers(options)` resolves to `{ http?, https?, http2? }`. Each property is a Node server, or an array when configured with an array. `createServer` is an alias. `createServers(options, (error, servers) => {})` retains the callback style and returns a Promise that resolves after the callback.

| Option                                           | Behavior                                                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `http`                                           | Port number/string, listener object, or array of those. Default port 80 for an object.                                                                                                                                         |
| `https`, `http2`                                 | TLS listener object or array. Default port 443. HTTP/2 is secure; `allowHTTP1` enables fallback.                                                                                                                               |
| `host`, `handler`, `timeout`, `keepAliveTimeout` | Shared defaults; individual listeners may override them. Timeouts are milliseconds. A handler is required for every listener. Port 0 requests an ephemeral port.                                                               |
| TLS `root`, `key`, `cert`, `ca`                  | Relative file paths resolve against `root` (default current directory). Buffers and inline PEM strings also work. Certificate arrays form one chain unless key is also an array. Other Node HTTPS server options pass through. |
| TLS `sni`                                        | Map of hostname/wildcard patterns to TLS configurations, prepared before listening. A supplied `SNICallback` takes precedence.                                                                                                 |
| TLS `ciphers`                                    | String or array joined with `:`. Node 24's TLS defaults apply when omitted.                                                                                                                                                    |
| `log`                                            | Optional function receiving listener startup messages.                                                                                                                                                                         |

The shared handler uses the HTTP/1 compatibility request/response methods supported by HTTP/2. Use the returned HTTP/2 server's `stream` event for HTTP/2-specific behavior.

Unlike upstream's partially successful startup, any failure rejects with an `AggregateError` and closes all listeners opened by that invocation. Callback errors also receive no partial listeners. Protocol startup is concurrent and caller options are not mutated. Deprecated SSL defaults and the `connected`/`errs` dependencies are removed.

## Development

Requires Node.js 24+ and pnpm. From the workspace root:

```sh
pnpm install
pnpm http:build
pnpm --filter @yukino.js/create-servers test
pnpm --filter @yukino.js/create-servers typecheck
pnpm --filter @yukino.js/create-servers lint
pnpm --filter @yukino.js/create-servers format:check
```

ESM JavaScript and source maps are bundled with Rolldown; TypeScript emits declarations. Tests use Vitest and real local listeners. See [NOTICE.md](./NOTICE.md) for upstream attribution.
