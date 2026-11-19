#!/usr/bin/env node
import { registryMock, type CachedRequest } from "./index.js";
try {
  const port = Number(process.env.PORT ?? 3676);
  const registry = await registryMock({ http: port });
  registry.on("cached", (request: CachedRequest) => {
    console.log(
      "%s %s %s",
      request.method,
      request.url,
      request.body.toString(),
    );
    if (process.env.DUMP_CACHE || request.headers["x-dump-cache"])
      console.dir(registry.cache);
  });
  console.log(
    "npm-registry-echo listening on %s",
    (registry.address() as { port: number }).port,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => registry.close());
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
