#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { getPort } from "@yukino.js/port-finder";
import { createServer, type HttpServerOptions } from "./index.js";

try {
  // Accept traditional compact negative cache arguments, e.g. -c-1.
  let args = process.argv
    .slice(2)
    .flatMap((value) =>
      /^-[pct]-?\d+$/.test(value)
        ? [
            `--${({ p: "port", c: "cache", t: "timeout" } as Record<string, string>)[value[1]!]}=${value.slice(2)}`,
          ]
        : [value],
    );
  const normalized: string[] = [];
  const dotted: Record<string, unknown> = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--cors=")) {
      normalized.push("--cors", "--cors-headers", arg.slice(7));
    } else if (arg.startsWith("--robots=")) {
      normalized.push("--robots", "--robots-content", arg.slice(9));
    } else if (["-d", "-i", "--directories", "--index"].includes(arg)) {
      const value = args[i + 1];
      normalized.push(
        arg,
        value === "true" || value === "false" ? args[++i]! : "true",
      );
    } else if (arg === "-o" || arg === "--open") {
      normalized.push(
        "--open",
        args[i + 1] && !args[i + 1]!.startsWith("-") ? args[++i]! : "/",
      );
    } else if (arg.startsWith("--proxy-options.")) {
      const [key, inline] = arg.slice(16).split("=", 2);
      if (
        !key ||
        ["__proto__", "constructor", "prototype"].some((part) =>
          key.split(".").includes(part),
        )
      )
        throw new Error("Invalid proxy option");
      const value = inline ?? args[++i];
      if (value === undefined) throw new Error("Proxy option requires a value");
      let target = dotted;
      const parts = key.split(".");
      for (const part of parts.slice(0, -1)) {
        target[part] ??= Object.create(null);
        target = target[part] as Record<string, unknown>;
      }
      try {
        target[parts.at(-1)!] = JSON.parse(value);
      } catch {
        target[parts.at(-1)!] = value;
      }
    } else if (arg === "-dir-overrides-404")
      normalized.push("--dir-overrides-404");
    else normalized.push(arg);
  }
  args = normalized;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p" },
      address: { type: "string", short: "a", default: "0.0.0.0" },
      cache: { type: "string", short: "c" },
      timeout: { type: "string", short: "t" },
      ext: { type: "string", short: "e" },
      "base-dir": { type: "string" },
      open: { type: "string", short: "o" },
      title: { type: "string", short: "T" },
      utc: { type: "boolean", short: "U" },
      "log-ip": { type: "boolean" },
      mimetypes: { type: "string" },
      "robots-content": { type: "string" },
      gzip: { type: "boolean", short: "g" },
      brotli: { type: "boolean", short: "b" },
      directories: { type: "string", short: "d" },
      index: { type: "string", short: "i" },
      "dir-overrides-404": { type: "boolean" },
      "no-dotfiles": { type: "boolean" },
      "hide-permissions": { type: "boolean" },
      cors: { type: "boolean" },
      "cors-headers": { type: "string" },
      coop: { type: "boolean" },
      "private-network-access": { type: "boolean" },
      header: { type: "string", short: "H", multiple: true },
      robots: { type: "boolean", short: "r" },
      proxy: { type: "string", short: "P" },
      "proxy-all": { type: "boolean" },
      "proxy-options": { type: "string" },
      "proxy-config": { type: "string" },
      websocket: { type: "boolean" },
      username: { type: "string" },
      user: { type: "string" },
      password: { type: "string" },
      "allowed-hosts": { type: "string" },
      ssl: { type: "boolean", short: "S" },
      tls: { type: "boolean" },
      cert: { type: "string", short: "C", default: "cert.pem" },
      key: { type: "string", short: "K", default: "key.pem" },
      silent: { type: "boolean", short: "s" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.help) {
    console.log(`Usage: http-server [path] [options]
  -p, --port <port>      Port (default PORT or 8080; 0 finds a free port)
  -a, --address <host>   Bind address (default 0.0.0.0)
  -c, --cache <seconds>  Cache max age (default 3600; -1 disables caching)
  -t, --timeout <secs>   Connection timeout (default 120)
  -d <true|false>        Directory listings
  -i <true|false>        Serve index.html
  -e, --ext <extension>  Default extension (default html)
  -g, --gzip            Serve precompressed gzip files
  -b, --brotli          Serve precompressed brotli files
  --cors[=<headers>]    Enable CORS (--cors-headers also adds headers)
  --mimetypes <file>     Load a .types MIME definitions file
  -o, --open [path]      Open a browser after startup
  -T, --title <text>     Terminal title; -U/--utc uses UTC logs
  --log-ip              Include client addresses in logs
  -H, --header <header> Add a response header (repeatable)
  -P, --proxy <url>      Proxy missing files (--proxy-all forwards everything)
  --proxy-options <json> / --proxy-config <json-or-file>
  --websocket           Proxy WebSocket upgrades
  --username <user> --password <password>
  --allowed-hosts <list> Comma-separated permitted hosts
  -S, --ssl             Serve HTTPS (-C cert.pem -K key.pem)
  --base-dir <path> --no-dotfiles --hide-permissions --dir-overrides-404
  --coop --private-network-access -r/--robots -s/--silent
  -h, --help            Show help
  -v, --version         Show version`);
  } else if (values.version) console.log("0.0.0");
  else {
    if (positionals.length > 1)
      throw new Error("Only one root path is accepted");
    const numeric = (value: string | undefined, fallback: number) => {
      const number = Number(value ?? fallback);
      if (!Number.isFinite(number))
        throw new Error(`Invalid numeric option: ${value}`);
      return number;
    };
    const host = values.address;
    let port = numeric(values.port ?? process.env.PORT, 8080);
    if (port === 0) port = await getPort({ port: 8080, host });
    const headers: Record<string, string> = {};
    for (const header of values.header ?? []) {
      const index = header.indexOf(":");
      if (index <= 0) throw new Error("Headers must have the form Name: value");
      headers[header.slice(0, index).trim()] = header.slice(index + 1).trim();
    }
    const config: HttpServerOptions = {
      root: positionals[0],
      baseDir: values["base-dir"],
      headers,
      cache: numeric(values.cache, 3600),
      timeout: numeric(values.timeout, 120) * 1000,
      ext: values.ext,
      showDir: values.directories !== "false",
      autoIndex: values.index !== "false",
      dirOverrides404: values["dir-overrides-404"],
      showDotfiles: !values["no-dotfiles"],
      hidePermissions: values["hide-permissions"],
      gzip: values.gzip,
      brotli: values.brotli,
      cors: values.cors,
      corsHeaders: values["cors-headers"],
      coop: values.coop,
      privateNetworkAccess: values["private-network-access"],
      robots: values["robots-content"] ?? values.robots,
      proxy: values.proxy,
      proxyAll: values["proxy-all"],
      websocket: values.websocket,
      username: values.username ?? values.user,
      password: values.password,
      allowedHosts: values["allowed-hosts"]?.split(","),
    };
    if (values["proxy-options"])
      config.proxyOptions = JSON.parse(values["proxy-options"]);
    config.proxyOptions = { ...config.proxyOptions, ...dotted };
    if (values.mimetypes) {
      config.mimetypes = {};
      for (const line of (await readFile(values.mimetypes, "utf8")).split(
        /\r?\n/,
      )) {
        const [mime, ...extensions] = line
          .replace(/#.*/, "")
          .trim()
          .split(/\s+/);
        if (mime)
          for (const extension of extensions)
            config.mimetypes[extension] = mime;
      }
    }
    if (values["proxy-config"]) {
      const input = values["proxy-config"];
      config.proxyConfig = JSON.parse(
        input.trim().startsWith("{") ? input : await readFile(input, "utf8"),
      );
    }
    if (values.ssl || values.tls)
      config.https = {
        cert: await readFile(values.cert!),
        key: await readFile(values.key!),
        passphrase: process.env.NODE_HTTP_SERVER_SSL_PASSPHRASE,
      };
    if (!values.silent)
      config.logFn = (req) =>
        console.log(
          "%s %s%s %s",
          values.utc ? new Date().toUTCString() : new Date().toLocaleString(),
          values["log-ip"] ? req.socket.remoteAddress + " " : "",
          req.method,
          req.url,
        );
    if (
      values.open &&
      !["http:", "https:"].includes(
        new URL(values.open, "http://localhost").protocol,
      )
    )
      throw new Error("Browser URL must be HTTP(S)");
    const server = createServer(config);
    server.server.once("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      const address =
        host === "0.0.0.0" || host === "::"
          ? "127.0.0.1"
          : host!.includes(":")
            ? `[${host}]`
            : host;
      const url = `${config.https ? "https" : "http"}://${address}:${(server.address() as { port: number }).port}`;
      if (values.title && process.stdout.isTTY)
        process.stdout.write(
          `\x1b]0;http-server ${port} ${[...values.title].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("")}\x07`,
        );
      if (values.open) {
        const destination = new URL(values.open, url);
        if (!["http:", "https:"].includes(destination.protocol))
          throw new Error("Browser URL must be HTTP(S)");
        const command =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "rundll32"
              : "xdg-open";
        const child = spawn(
          command,
          process.platform === "win32"
            ? ["url.dll,FileProtocolHandler", destination.href]
            : [destination.href],
          { stdio: "ignore" },
        );
        child.on("error", (error) =>
          console.error(`Unable to open browser: ${error.message}`),
        );
        child.unref();
      }
      if (!values.silent)
        console.log(
          `Serving ${server.root} at ${config.https ? "https" : "http"}://${host}:${(server.address() as { port: number }).port}`,
        );
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => server.close());
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
