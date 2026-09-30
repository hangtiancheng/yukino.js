/**
 * History-only router, aligned with react-router's data model, built on
 * signals — **factory-based, no module-level singleton state**.
 *
 * ```ts
 * const router = createRouter(
 *   [
 *     { path: "/", component: Home },
 *     { path: "/users/:id", component: UserDetail },
 *     { path: "/admin", lazy: () => import("./views/admin") },
 *     { path: "*", component: NotFound },
 *   ],
 *   { basename: "/app" },
 * );
 * render(<RouterView router={router} />, container);
 * ```
 *
 * - `router.location` — `ReadonlySignal<Location>` with the react-router
 *   shape `{ pathname, search, hash, state, key }` (pathname is
 *   basename-stripped). Reading `.value` in a tracked region subscribes.
 * - `router.match` / `router.params` / `router.searchParams` — computeds.
 * - `router.navigate(to, { replace, state })` — react-router `navigate`
 *   semantics; resolves `false` when a blocker rejected.
 * - `router.block(blocker)` — async navigation blocking; blocked history
 *   traversals are reverted via `history.go(delta)`.
 * - `router.dispose()` — detach the popstate listener.
 *
 * `createRouter` also records the instance as the ACTIVE router so that
 * `useRouter()` / `<RouterView/>` / `useUrlState()` resolve it without prop
 * drilling (share `@yukino.js/react-signal` as an MF singleton — each copy of the
 * library would otherwise have its own active pointer).
 *
 * Route matching supports dynamic segments (`/users/:id`), splats (`*`,
 * `/files/*`) and react-router-style ranking (static > dynamic > splat).
 * History mode only — there is no hash routing.
 */
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

// ============================================================
// Pure helpers (no router state)
// ============================================================

/** History state wrapper (history v5 layout: user state + entry key + index). */
interface StateWrapper {
  usr: unknown;
  key: string;
  idx: number;
}

let keySeq = 0;

function createKey(): string {
  return `k${++keySeq}${Math.random().toString(36).slice(2, 8)}`;
}

/** Read the wrapper a router wrote into `history.state`, if any. */
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

/** Build a raw `Location` from the current window URL + history state. */
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

/** Parse a `To` string into path parts (react-router `parsePath`). */
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

/** Normalize a `search`/`hash` part to start with its prefix (or be ""). */
function normalizePart(value: string | undefined, prefix: "?" | "#"): string {
  if (!value || value === prefix) return "";
  return value.startsWith(prefix) ? value : prefix + value;
}

// ============================================================
// Route matching (react-router data model: :params, *, ranking)
// ============================================================

function splitSegments(path: string): string[] {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

/** Rank a route pattern (react-router-style: static > dynamic > splat). */
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

/**
 * Match a single route pattern against a pathname.
 *
 * Supports `:param` dynamic segments and a trailing `*` splat (captured as
 * `params["*"]`). Static segments compare case-insensitively (react-router
 * default). Returns the captured params, or `null` when the pattern does
 * not match.
 */
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

/**
 * Match a pathname against a flat route table, react-router style: all
 * candidates are ranked (static segments outrank dynamic ones, splats rank
 * last) and the best-scoring match wins; ties resolve in registration order.
 */
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

// ============================================================
// Lazy route resolution (in-flight dedup, cached on the route)
// ============================================================

const pendingLazy = new Map<RouteObject, Promise<Component>>();

/**
 * Resolve a route's component: `component` synchronously, otherwise start
 * (or join) the `lazy()` load. The resolved component is cached on the route
 * object; failures clear the in-flight marker and PROPAGATE (no swallowing).
 */
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
        route.component = fn; // subsequent matches render synchronously
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

// ============================================================
// createRouter (factory — all state closure-scoped)
// ============================================================

export interface RouterOptions {
  /** Base path prepended to all hrefs and stripped before matching. */
  basename?: string;
}

/** The active router (last created wins) — resolved by `useRouter()`. */
let activeRouter: RouterApi | null = null;

/**
 * Create a history router over a route table. All state lives in the
 * returned instance; the instance is also recorded as the ACTIVE router
 * for `useRouter()` / `<RouterView/>`.
 */
export function createRouter(
  routes: RouteObject[],
  options: RouterOptions = {},
): RouterApi {
  const basename = options.basename
    ? `/${options.basename.replace(/^\/+|\/+$/g, "")}`
    : "";
  const routeTable = [...routes];

  /** Strip the basename; `null` when the pathname is outside it. */
  const stripBasename = (pathname: string): string | null => {
    if (!basename) return pathname;
    if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) return null;
    const rest = pathname.slice(basename.length);
    if (rest && !rest.startsWith("/")) return null;
    return rest || "/";
  };

  /** react-router semantics: the public pathname has the basename stripped. */
  const toPublic = (raw: Location): Location => {
    const stripped = stripBasename(raw.pathname);
    if (stripped == null || stripped === raw.pathname) return raw;
    return { ...raw, pathname: stripped };
  };

  /** Serialize a (public) location into the href written to the URL bar. */
  const createHref = (loc: Location): string =>
    `${basename}${loc.pathname}${loc.search}${loc.hash}`;

  // ---- signals -------------------------------------------------------

  /** Raw window location (pathname INCLUDES the basename). */
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

  // ---- navigation ----------------------------------------------------

  const blockers = new Set<Blocker>();

  /** Current history stack index (mirrors `history.state.idx`). */
  let index = 0;

  /** Swallow the popstate echo produced by a blocker-rejected revert. */
  let revertingPop = false;

  /** Commit the CURRENT window URL + history state — one signal write. */
  const commit = (): void => {
    rawLocation.value = readWindowLocation();
  };

  /** Run blockers in registration order; first `false`/throw blocks. */
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

  /** Resolve a `To` against the current (public) location. */
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
    // Navigating to the current href replaces instead of pushing
    // (react-router behavior — avoids duplicate history entries).
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

  // ---- popstate ------------------------------------------------------

  // Blockers run AFTER the browser already moved (popstate is
  // post-traversal): consult them at the target, and revert via
  // `history.go(delta)` on rejection (the echo popstate is swallowed).
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

  // ---- wire up -------------------------------------------------------

  // Seed the current entry with an index (preserving pre-existing state and
  // the CURRENT URL — never rewrite it here).
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

// ============================================================
// Router hooks + RouterView
// ============================================================

/**
 * The active router (the last `createRouter` result). Throws when no router
 * has been created — create one during app boot.
 */
export function useRouter(): RouterApi {
  if (!activeRouter) {
    throw new Error("useRouter: no active router — call createRouter() first");
  }
  return activeRouter;
}

/**
 * Register a navigation blocker for this component's lifetime (react-router
 * `useBlocker`): registered on mount, unregistered on unmount. The blocker
 * closure is captured on the first render.
 */
export function useBlocker(blocker: Blocker): void {
  const router = useRouter();
  useValueSlot(
    () => router.block(blocker),
    (unblock) => (unblock as () => void)(),
  );
}

/**
 * Route outlet component: renders the active router's matched component
 * (hostless — the matched component's DOM splices directly into the
 * parent). Pass `router` explicitly, or omit it to use the active router.
 *
 * - Route change → the component swaps (old instance unmounted by the diff).
 * - Param-only change → SAME instance; the component re-renders only if it
 *   read `router.params` / `router.location` (tracked reads).
 * - `lazy` routes resolve once (in-flight dedup, cached on the route);
 *   nothing renders until the load lands. Load failures propagate as
 *   unhandled rejections — there is no swallowing.
 *
 * @example
 * const router = createRouter(routes);
 * render(<RouterView router={router} />, document.getElementById("root")!);
 */
export function RouterView(props: { router?: RouterApi }): JSXNode {
  const explicit = props.router as RouterApi | undefined; // tracked prop read
  const router = explicit ?? useRouter();
  const lazyTick = useSignal(0);

  // Kick off lazy loads when an unresolved route matches; bump the tick on
  // completion so the body below re-renders with route.component populated.
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

  const m = router.match.value; // tracked — re-render per committed navigation
  lazyTick.value; // tracked — re-render when a lazy load lands
  const fn = m?.route.component;
  return fn ? createVNode(fn, {}) : null;
}
