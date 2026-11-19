# @yukino.js/http-proxy

Streaming HTTP/HTTPS reverse proxy with WebSocket tunneling, typed events, per-request configuration and response rewriting. Rewritten from `node-http-proxy`; no dependency on the upstream implementation.

```ts
import { createServer } from "node:http";
import { createProxyServer } from "@yukino.js/http-proxy";

const proxy = createProxyServer({
  target: "http://127.0.0.1:9000",
  changeOrigin: true,
  xfwd: true,
});
const server = createServer((req, res) => {
  proxy.web(req, res, (error) => {
    res.writeHead(502);
    res.end(error.message);
  });
});
server.on("upgrade", (req, socket, head) => proxy.ws(req, socket, head));
proxy.on("error", (_error, _req, response) => response?.destroy());
server.listen(8080);
```

`createProxyServer`, `createServer` and `createProxy` return a `ProxyServer` (`Server` alias). The default export contains these factories and classes. `web(req, res, options?, callback?)` and `ws(req, socket, head, options?, callback?)` shallowly merge per-request options over constructor defaults. `proxyRequest` and `proxyWebsocketRequest` are aliases.

`proxy.listen(port, hostname?, callback?)` creates an HTTP listener, or HTTPS when `ssl` is supplied; `ws: true` attaches upgrades. `proxy.close(callback?)` closes that listener and destroys tracked upgraded sockets. A proxy attached to an external server leaves that server's lifecycle to its caller.

| Option                                          | Behavior                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`, `forward`                             | URL string, WHATWG URL, or Node request-options object. HTTP(S) and WS(S) targets supported. `forward` mirrors the stream, or acts as the only target.     |
| `changeOrigin`, `xfwd`, `headers`, `auth`       | Rewrite Host, append X-Forwarded-* headers, add outgoing headers, or set Basic authentication.                                                             |
| `prependPath`                                   | Prepend the target path (default true).                                                                                                                    |
| `ignorePath`, `toProxy`                         | Ignore the incoming URL, or preserve an absolute incoming URL for a forward proxy.                                                                         |
| `agent`, `localAddress`, `secure`               | Node transport options. TLS verification is enabled unless `secure: false`. TLS fields on an object target support client certificates.                    |
| `timeout`, `proxyTimeout`                       | Incoming/outgoing inactivity timeouts in milliseconds.                                                                                                     |
| `hostRewrite`, `autoRewrite`, `protocolRewrite` | Rewrite absolute Location headers pointing to the upstream authority.                                                                                      |
| `cookieDomainRewrite`, `cookiePathRewrite`      | String, mapping with optional `*` fallback, or false. An empty string removes the attribute.                                                               |
| `preserveHeaderKeyCase`                         | Retain upstream response header names.                                                                                                                     |
| `selfHandleResponse`                            | Hand response ownership to a `proxyRes` listener.                                                                                                          |
| `buffer`                                        | A Readable used instead of the original request body.                                                                                                      |
| `followRedirects`                               | Follow upstream redirects using `follow-redirects` (normal streaming does not buffer; redirect following uses that library's replay buffering and limits). |

Events: `start`, `proxyReq`, `proxyRes`, `end`, `proxyReqWs`, `open`, `close`, `error`; legacy `proxySocket` and `econnreset` are also emitted. Listen for `error` or provide a per-request callback. `proxyReq`/`proxyReqWs` run before headers are sent.

`before('web' | 'ws', name, pass)` and `after(...)` insert named passes. The built-in pass is `stream`; returning true stops processing. This implementation does not expose the upstream internal collection of small pass names or `createRightProxy` internals. Named exports, native EventEmitter semantics, WHATWG URLs and modern TLS defaults replace the legacy CommonJS/eventemitter3 architecture. Connection-specific headers are removed from normal HTTP traffic. WebSocket upgrades preserve handshake headers and any buffered bytes.

## Development

Requires Node.js 24+ and pnpm. From the workspace root:

```sh
pnpm install
pnpm http:build
pnpm --filter @yukino.js/http-proxy test
pnpm --filter @yukino.js/http-proxy typecheck
pnpm --filter @yukino.js/http-proxy lint
pnpm --filter @yukino.js/http-proxy format:check
```

ESM JavaScript and source maps are bundled with Rolldown; TypeScript emits declarations. Tests use Vitest and real local listeners. See [NOTICE.md](./NOTICE.md) for upstream attribution.
