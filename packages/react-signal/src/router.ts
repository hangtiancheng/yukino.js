import { signal, computed, untracked, type ReadonlySignal } from "./reactive";
import { devWarn } from "./utils";
import { useSignal, useSignalEffect } from "./hooks";
import { createVNode, type Component, type JSXNode } from "./jsx/vnode";
import { useValueSlot } from "./component";
import type {
  Location,
  To,
  NavigateOptions,
  RouteObject,
  RouteMatch,
  Blocker,
  RouterApi,
} from "./types";

interface StateWrapper {
  usr: unknown;
  key: string;
  idx: number;
}

let keySeq = 0;

function createKey(): string {
  return `k${++keySeq}${Math.random().toString(36).slice(2, 8)}`;
}

function readWrapper(): StateWrapper | null {
  const s: unknown = globalThis.history.state;
  if (
    s &&
    typeof s === "object" &&
    typeof (s as StateWrapper).idx === "number"
  ) {
    return s as StateWrapper;
  }
  return null;
}

function readWindowLocation(): Location {
  const { pathname, search, hash } = globalThis.location;
  const wrapper = readWrapper();
  return {
    pathname,
    search,
    hash,
    state: wrapper ? wrapper.usr : globalThis.history.state,
    key: wrapper ? wrapper.key : "default",
  };
}

function parsePath(path: string): {
  pathname?: string;
  search?: string;
  hash?: string;
} {
  const parsed: { pathname?: string; search?: string; hash?: string } = {};
  let rest = path;
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    parsed.hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }
  const searchIdx = rest.indexOf("?");
  if (searchIdx >= 0) {
    parsed.search = rest.slice(searchIdx);
    rest = rest.slice(0, searchIdx);
  }
  if (rest) parsed.pathname = rest;
  return parsed;
}

function normalizePart(value: string | undefined, prefix: "?" | "#"): string {
  if (!value || value === prefix) return "";
  return value.startsWith(prefix) ? value : prefix + value;
}

function splitSegments(path: string): string[] {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

function scorePath(path: string): number {
  const segments = splitSegments(path);
  let score = segments.length;
  for (const seg of segments) {
    if (seg === "*") score -= 2;
    else if (seg.startsWith(":")) score += 3;
    else score += 10;
  }
  return score;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const pSegs = splitSegments(pattern);
  const uSegs = splitSegments(pathname);
  const params: Record<string, string> = {};

  for (let i = 0; i < pSegs.length; i++) {
    const p = pSegs[i];
    if (p === "*") {
      if (i !== pSegs.length - 1) {
        devWarn(
          `Invalid route pattern "${pattern}" — "*" is only allowed as the last segment.`,
        );
        return null;
      }
      params["*"] = uSegs.slice(i).map(decodeSegment).join("/");
      return params;
    }
    const u = uSegs[i];
    if (u === undefined) return null;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeSegment(u);
    } else if (p.toLowerCase() !== u.toLowerCase()) {
      return null;
    }
  }
  return pSegs.length === uSegs.length ? params : null;
}

export function matchRoutes(
  routes: RouteObject[],
  pathname: string,
): RouteMatch | null {
  let best: RouteMatch | null = null;
  let bestScore = -Infinity;
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (!params) continue;
    const score = scorePath(route.path);
    if (score > bestScore) {
      bestScore = score;
      best = { route, params, pathname };
    }
  }
  return best;
}

const pendingLazy = new Map<RouteObject, Promise<Component>>();

function resolveRouteComponent(
  route: RouteObject,
): Component | Promise<Component> | undefined {
  if (route.component) return route.component;
  if (!route.lazy) return undefined;
  let pending = pendingLazy.get(route);
  if (!pending) {
    pending = Promise.resolve(route.lazy()).then(
      (mod) => {
        pendingLazy.delete(route);
        const fn = (
          mod && typeof mod === "object" && "default" in mod
            ? (mod as { default: Component }).default
            : mod
        ) as Component;
        route.component = fn;
        return fn;
      },
      (err: unknown) => {
        pendingLazy.delete(route);
        throw err;
      },
    );
    pendingLazy.set(route, pending);
  }
  return pending;
}

export interface RouterOptions {
  basename?: string;
}

let activeRouter: RouterApi | null = null;

export function createRouter(
  routes: RouteObject[],
  options: RouterOptions = {},
): RouterApi {
  const basename = options.basename
    ? `/${options.basename.replace(/^\/+|\/+$/g, "")}`
    : "";
  const routeTable = [...routes];

  const stripBasename = (pathname: string): string | null => {
    if (!basename) return pathname;
    if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) return null;
    const rest = pathname.slice(basename.length);
    if (rest && !rest.startsWith("/")) return null;
    return rest || "/";
  };

  const toPublic = (raw: Location): Location => {
    const stripped = stripBasename(raw.pathname);
    if (stripped == null || stripped === raw.pathname) return raw;
    return { ...raw, pathname: stripped };
  };

  const createHref = (loc: Location): string =>
    `${basename}${loc.pathname}${loc.search}${loc.hash}`;

  const rawLocation = signal<Location>(readWindowLocation());

  const location: ReadonlySignal<Location> = computed(() =>
    toPublic(rawLocation.value),
  );

  const match: ReadonlySignal<RouteMatch | null> = computed(() => {
    const pathname = stripBasename(rawLocation.value.pathname);
    if (pathname == null) return null;
    return matchRoutes(routeTable, pathname);
  });

  const params: ReadonlySignal<Record<string, string>> = computed(
    () => match.value?.params ?? {},
  );

  const searchParams: ReadonlySignal<URLSearchParams> = computed(
    () => new URLSearchParams(rawLocation.value.search),
  );

  const blockers = new Set<Blocker>();

  let index = 0;

  let revertingPop = false;

  const commit = (): void => {
    rawLocation.value = readWindowLocation();
  };

  const runBlockers = async (
    next: Location,
    current: Location,
  ): Promise<boolean> => {
    for (const blocker of Array.from(blockers)) {
      try {
        const result = await blocker(next, current);
        if (result === false) return false;
      } catch (err) {
        devWarn(
          `Navigation blocker threw (${String(err)}) — treated as a block.`,
        );
        return false;
      }
    }
    return true;
  };

  const resolveLocation = (to: To, state: unknown): Location => {
    const current = location.peek();
    const path = typeof to === "string" ? parsePath(to) : to;
    let pathname = path.pathname ?? current.pathname;
    if (!pathname.startsWith("/")) pathname = `/${pathname}`;
    return {
      pathname,
      search: normalizePart(path.search, "?"),
      hash: normalizePart(path.hash, "#"),
      state,
      key: createKey(),
    };
  };

  const navigate = async (
    to: To | number,
    options: NavigateOptions = {},
  ): Promise<boolean> => {
    if (typeof to === "number") {
      globalThis.history.go(to);
      return true;
    }

    const current = location.peek();
    const next = resolveLocation(to, options.state);

    if (blockers.size > 0 && !(await runBlockers(next, current))) {
      return false;
    }

    const href = createHref(next);
    const replace = options.replace || href === createHref(current);
    const idx = replace ? index : index + 1;
    const wrapper: StateWrapper = { usr: options.state, key: next.key, idx };

    if (replace) {
      globalThis.history.replaceState(wrapper, "", href);
    } else {
      globalThis.history.pushState(wrapper, "", href);
    }
    index = idx;
    commit();
    return true;
  };

  const block = (blocker: Blocker): (() => void) => {
    blockers.add(blocker);
    return () => {
      blockers.delete(blocker);
    };
  };

  const handlePop = (): void => {
    if (revertingPop) {
      revertingPop = false;
      return;
    }
    const wrapper = readWrapper();
    if (blockers.size === 0) {
      index = wrapper?.idx ?? index;
      commit();
      return;
    }
    const target = toPublic(readWindowLocation());
    void runBlockers(target, location.peek()).then((ok) => {
      if (ok) {
        index = wrapper?.idx ?? index;
        commit();
      } else if (wrapper) {
        const delta = index - wrapper.idx;
        if (delta !== 0) {
          revertingPop = true;
          globalThis.history.go(delta);
        }
      }
    });
  };

  const wrapper = readWrapper();
  if (wrapper) {
    index = wrapper.idx;
  } else {
    index = 0;
    const seeded: StateWrapper = {
      usr: globalThis.history.state,
      key: createKey(),
      idx: 0,
    };
    globalThis.history.replaceState(seeded, "", globalThis.location.href);
  }

  globalThis.addEventListener("popstate", handlePop);
  commit();

  const router: RouterApi = {
    location,
    match,
    params,
    searchParams,
    navigate,
    block,
    dispose(): void {
      globalThis.removeEventListener("popstate", handlePop);
      blockers.clear();
      if (activeRouter === router) activeRouter = null;
    },
  };

  activeRouter = router;
  return router;
}

export function useRouter(): RouterApi {
  if (!activeRouter) {
    throw new Error("useRouter: no active router — call createRouter() first");
  }
  return activeRouter;
}

export function useBlocker(blocker: Blocker): void {
  const router = useRouter();
  useValueSlot(
    () => router.block(blocker),
    (unblock) => (unblock as () => void)(),
  );
}

export function RouterView(props: { router?: RouterApi }): JSXNode {
  const explicit = props.router as RouterApi | undefined;
  const router = explicit ?? useRouter();
  const lazyTick = useSignal(0);

  useSignalEffect(() => {
    const m = ((props.router as RouterApi | undefined) ?? useRouter()).match
      .value;
    if (!m || m.route.component) return;
    const resolved = resolveRouteComponent(m.route);
    if (resolved instanceof Promise) {
      untracked(() => {
        void resolved.then(() => lazyTick.value++);
      });
    }
  });

  const m = router.match.value;
  lazyTick.value;
  const fn = m?.route.component;
  return fn ? createVNode(fn, {}) : null;
}
