import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRouter,
  matchPath,
  matchRoutes,
  useRouter,
} from "@yukino.js/react";
import type { RouteObject, RouterApi } from "@yukino.js/react";

const Home = (): null => null;
const User = (): null => null;
const Files = (): null => null;
const NotFound = (): null => null;

function poll(predicate: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeout)
        return reject(new Error("poll timeout"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

let router: RouterApi | undefined;

beforeEach(() => {
  globalThis.history.replaceState(null, "", "/");
});

afterEach(() => {
  router?.dispose();
  router = undefined;
});

describe("matchPath", () => {
  it("matches static paths exactly", () => {
    expect(matchPath("/home", "/home")).toEqual({});
    expect(matchPath("/home", "/about")).toBeNull();
    expect(matchPath("/a/b", "/a")).toBeNull();
    expect(matchPath("/a", "/a/b")).toBeNull();
  });

  it("matches the root path", () => {
    expect(matchPath("/", "/")).toEqual({});
    expect(matchPath("/", "/home")).toBeNull();
  });

  it("is case-insensitive on static segments (react-router default)", () => {
    expect(matchPath("/Home", "/home")).toEqual({});
  });

  it("ignores trailing slashes", () => {
    expect(matchPath("/home/", "/home")).toEqual({});
    expect(matchPath("/home", "/home/")).toEqual({});
  });

  it("captures :param segments (decoded)", () => {
    expect(matchPath("/users/:id", "/users/42")).toEqual({ id: "42" });
    expect(matchPath("/users/:id/posts/:postId", "/users/7/posts/9")).toEqual({
      id: "7",
      postId: "9",
    });
    expect(matchPath("/tags/:name", "/tags/a%20b")).toEqual({ name: "a b" });
    expect(matchPath("/users/:id", "/users")).toBeNull();
  });

  it("captures splats", () => {
    expect(matchPath("*", "/anything/at/all")).toEqual({
      "*": "anything/at/all",
    });
    expect(matchPath("*", "/")).toEqual({ "*": "" });
    expect(matchPath("/files/*", "/files/a/b.txt")).toEqual({ "*": "a/b.txt" });
    expect(matchPath("/files/*", "/other/a")).toBeNull();
  });
});

describe("matchRoutes ranking", () => {
  const routes: RouteObject[] = [
    { path: "*", component: NotFound },
    { path: "/users/:id", component: User },
    { path: "/users/new", component: Home },
    { path: "/files/*", component: Files },
  ];

  it("prefers static segments over dynamic ones", () => {
    expect(matchRoutes(routes, "/users/new")?.route.component).toBe(Home);
    expect(matchRoutes(routes, "/users/42")?.route.component).toBe(User);
  });

  it("prefers dynamic segments over splats", () => {
    expect(matchRoutes(routes, "/files/a/b")?.route.component).toBe(Files);
    expect(matchRoutes(routes, "/nowhere")?.route.component).toBe(NotFound);
  });

  it("returns null when nothing matches", () => {
    expect(matchRoutes([{ path: "/a", component: Home }], "/b")).toBeNull();
  });

  it("resolves ties in registration order", () => {
    const first = { path: "/dup", component: Home };
    const second = { path: "/dup", component: User };
    expect(matchRoutes([first, second], "/dup")?.route).toBe(first);
  });
});

describe("createRouter — location", () => {
  it("commits the initial window location on creation", () => {
    globalThis.history.replaceState(null, "", "/start?a=1#top");
    router = createRouter([]);
    const loc = router.location;
    expect(loc.pathname).toBe("/start");
    expect(loc.search).toBe("?a=1");
    expect(loc.hash).toBe("#top");
  });

  it("navigate(href) pushes and updates the location", async () => {
    router = createRouter([]);
    const ok = await router.navigate("/users/42?tab=posts#bio");
    expect(ok).toBe(true);
    const loc = router.location;
    expect(loc.pathname).toBe("/users/42");
    expect(loc.search).toBe("?tab=posts");
    expect(loc.hash).toBe("#bio");
    expect(globalThis.location.pathname).toBe("/users/42");
    expect(globalThis.location.search).toBe("?tab=posts");
  });

  it("navigate(partial path) keeps the current pathname", async () => {
    router = createRouter([]);
    await router.navigate("/list");
    await router.navigate({ search: "?page=2" });
    expect(router.location.pathname).toBe("/list");
    expect(router.location.search).toBe("?page=2");
  });

  it("carries state and a per-entry key", async () => {
    router = createRouter([]);
    const before = router.location.key;
    await router.navigate("/next", { state: { from: "test" } });
    const loc = router.location;
    expect(loc.state).toEqual({ from: "test" });
    expect(loc.key).not.toBe(before);
  });

  it("navigating to the current href replaces instead of pushing", async () => {
    router = createRouter([]);
    await router.navigate("/same");
    const lenAfterFirst = globalThis.history.length;
    await router.navigate("/same");
    expect(globalThis.history.length).toBe(lenAfterFirst);
  });

  it("subscribe fires per committed navigation; unsubscribe stops it", async () => {
    router = createRouter([]);
    const seen: string[] = [];
    const off = router.subscribe(() => {
      seen.push(router!.location.pathname);
    });
    await router.navigate("/a");
    await router.navigate("/b");
    off();
    await router.navigate("/c");
    expect(seen).toEqual(["/a", "/b"]);
  });

  it("commits popstate traversals (back)", async () => {
    router = createRouter([]);
    await router.navigate("/first");
    await router.navigate("/second");
    globalThis.history.back();
    await poll(() => router!.location.pathname === "/first");
    expect(router.location.pathname).toBe("/first");
  });

  it("dispose() detaches the popstate listener", async () => {
    router = createRouter([]);
    await router.navigate("/x");
    await router.navigate("/y");
    router.dispose();
    globalThis.history.back();
    await new Promise((r) => setTimeout(r, 30));
    expect(router.location.pathname).toBe("/y"); // no commit after dispose
    router = undefined;
  });
});

describe("match / params / searchParams", () => {
  it("derives the ranked match and its params from the location", async () => {
    router = createRouter([
      { path: "/", component: Home },
      { path: "/users/:id", component: User },
      { path: "*", component: NotFound },
    ]);
    expect(router.match?.route.component).toBe(Home);
    await router.navigate("/users/42");
    expect(router.match?.route.component).toBe(User);
    expect(router.params).toEqual({ id: "42" });
    await router.navigate("/nope");
    expect(router.match?.route.component).toBe(NotFound);
    expect(router.params).toEqual({ "*": "nope" });
  });

  it("parses searchParams from the location", async () => {
    router = createRouter([]);
    await router.navigate("/list?page=2&size=10");
    expect(router.searchParams.get("page")).toBe("2");
    expect(router.searchParams.get("size")).toBe("10");
  });
});

describe("useRouter (outside a component)", () => {
  it("throws without an active router", () => {
    expect(() => useRouter()).toThrow(/no active router/);
  });

  it("requires a component context when a router exists (real hook)", () => {
    router = createRouter([]);
    expect(() => useRouter()).toThrow(/inside a function component/);
  });
});

describe("basename", () => {
  it("strips the basename before matching and prefixes hrefs", async () => {
    globalThis.history.replaceState(null, "", "/app/home");
    router = createRouter([{ path: "/home", component: Home }], {
      basename: "/app",
    });
    expect(router.match?.route.component).toBe(Home);
    expect(router.match?.pathname).toBe("/home");
    expect(router.location.pathname).toBe("/home"); // logical (RR semantics)
    await router.navigate("/users");
    expect(globalThis.location.pathname).toBe("/app/users");
    expect(router.location.pathname).toBe("/users");
  });

  it("yields no match outside the basename", () => {
    globalThis.history.replaceState(null, "", "/other/home");
    router = createRouter([{ path: "*", component: NotFound }], {
      basename: "/app",
    });
    expect(router.match).toBeNull();
  });
});

describe("blockers", () => {
  it("a false blocker aborts navigate() without touching the URL", async () => {
    router = createRouter([]);
    await router.navigate("/stay");
    const unblock = router.block(() => false);
    const ok = await router.navigate("/away");
    expect(ok).toBe(false);
    expect(router.location.pathname).toBe("/stay");
    expect(globalThis.location.pathname).toBe("/stay");
    unblock();
    expect(await router.navigate("/away")).toBe(true);
    expect(router.location.pathname).toBe("/away");
  });

  it("supports async blockers and passes (next, current)", async () => {
    router = createRouter([]);
    await router.navigate("/from");
    const calls: Array<[string, string]> = [];
    router.block(async (next, current) => {
      calls.push([next.pathname, current.pathname]);
      return next.pathname !== "/forbidden";
    });
    expect(await router.navigate("/forbidden")).toBe(false);
    expect(await router.navigate("/allowed")).toBe(true);
    expect(calls).toEqual([
      ["/forbidden", "/from"],
      ["/allowed", "/from"],
    ]);
  });

  it("a throwing blocker blocks", async () => {
    router = createRouter([]);
    router.block(() => {
      throw new Error("nope");
    });
    expect(await router.navigate("/x")).toBe(false);
  });

  it("blockers run in order and short-circuit on the first false", async () => {
    router = createRouter([]);
    const order: number[] = [];
    router.block(() => {
      order.push(1);
      return false;
    });
    router.block(() => {
      order.push(2);
      return true;
    });
    expect(await router.navigate("/x")).toBe(false);
    expect(order).toEqual([1]);
  });

  it("a rejected popstate traversal is reverted", async () => {
    router = createRouter([]);
    await router.navigate("/keep");
    await router.navigate("/leave");
    router.block((next) => next.pathname !== "/keep"); // block going back to /keep
    globalThis.history.back();
    await new Promise((r) => setTimeout(r, 50));
    await poll(() => globalThis.location.pathname === "/leave");
    expect(router.location.pathname).toBe("/leave"); // location never moved
  });
});
