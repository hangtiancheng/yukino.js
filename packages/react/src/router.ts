/**
 * History-only router, aligned with react-router's data model —
 * **factory-based, no module-level singleton state** (browser-only: the
 * factory touches `history`/`location` at creation, so create the router in
 * client boot code).
 *
 * ```tsx
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
 * - `router.location` — plain `Location` with the react-router shape
 *   `{ pathname, search, hash, state, key }` (pathname is basename-stripped);
 *   a fresh object per committed navigation.
 * - `router.match` / `router.params` / `router.searchParams` — plain values,
 *   recomputed at each commit.
 * - `router.subscribe(listener)` — the reactivity primitive: fires after
 *   every committed navigation (`useRouter` builds on it).
 * - `router.navigate(to, { replace, state })` — react-router `navigate`
 *   semantics; resolves `false` when a blocker rejected.
 * - `router.block(blocker)` — async navigation blocking; blocked history
 *   traversals are reverted via `history.go(delta)`.
 * - `router.dispose()` — detach the popstate listener.
 *
 * `createRouter` also records the instance as the ACTIVE router so that
 * `useRouter()` / `<RouterView/>` / `useUrlState()` resolve it without prop
 * drilling (share `@yukino.js/react` as an MF singleton — each copy of the
 * library would otherwise have its own active pointer).
 *
 * Route matching supports dynamic segments (`/users/:id`), splats (`*`,
 * `/files/*`) and react-router-style ranking (static > dynamic > splat).
 * History mode only — there is no hash routing.
 */
import { createElement } from "./element";
import type { ComponentType, VNode } from "./element";
import { useEffect, useMemo, useRef, useState } from "./hooks";

function devWarn(message: string): void {
  console.warn(`[yukino-react] ${message}`);
}

// ============================================================
// Types (react-router data model)
// ============================================================

/** A committed navigation entry (react-router `Location` shape). */
export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key: string;
}

/** Navigation target: a path string or a partial location. */
export type To = string | { pathname?: string; search?: string; hash?: string };

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
  /** Opaque state stored on the history entry (`location.state`). */
  state?: unknown;
}

/** A flat route table entry — no nesting, no loaders. */
export interface RouteObject {
  path: string;
  component?: ComponentType;
  lazy?: () => Promise<ComponentType | { default: ComponentType }>;
}

export interface RouteMatch {
  route: RouteObject;
  params: Record<string, string>;
  /** The matched pathname (basename-stripped). */
  pathname: string;
}

/** Return `false` (or throw) to block the navigation; may be async. */
export type Blocker = (
  next: Location,
  current: Location,
) => boolean | Promise<boolean>;

export interface RouterApi {
  /** Current location (basename-stripped) — fresh object per commit. */
  readonly location: Location;
  /** Best route match for the current location, or null. */
  readonly match: RouteMatch | null;
  /** Params of the current match (`{}` when unmatched). */
  readonly params: Record<string, string>;
  /** Parsed search params of the current location. */
  readonly searchParams: URLSearchParams;
  navigate(to: To | number, options?: NavigateOptions): Promise<boolean>;
  /** Fires after every committed navigation. Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void;
  block(blocker: Blocker): () => void;
  dispose(): void;
}

export interface RouterOptions {
  /** Base path prepended to all hrefs and stripped before matching. */
  basename?: string;
}

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

const pendingLazy = new Map<RouteObject, Promise<ComponentType>>();

/**
 * Resolve a route's component: `component` synchronously, otherwise start
 * (or join) the `lazy()` load. The resolved component is cached on the route
 * object; failures clear the in-flight marker and PROPAGATE (no swallowing).
 */
function resolveRouteComponent(
  route: RouteObject,
): ComponentType | Promise<ComponentType> | undefined {
  if (route.component) return route.component;
  if (!route.lazy) return undefined;
  let pending = pendingLazy.get(route);
  if (!pending) {
    pending = Promise.resolve(route.lazy()).then(
      (mod) => {
        pendingLazy.delete(route);
        const fn = (
          mod && typeof mod === "object" && "default" in mod
            ? (mod as { default: ComponentType }).default
            : mod
        ) as ComponentType;
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

  // ---- reactive surface (plain values + one listener set) -------------

  const listeners = new Set<() => void>();

  // All assigned by commit() during wire-up, before any read.
  let rawLocation!: Location;
  let currentLocation!: Location;
  let currentMatch!: RouteMatch | null;
  let currentParams!: Record<string, string>;
  let currentSearchParams!: URLSearchParams;

  /**
   * The single write point: re-read the window URL + history state,
   * recompute every derived value, then notify subscribers. A fresh
   * `currentLocation` object per commit doubles as the change marker
   * `useRouter` compares by identity.
   */
  const commit = (): void => {
    rawLocation = readWindowLocation();
    currentLocation = toPublic(rawLocation);
    const stripped = stripBasename(rawLocation.pathname);
    currentMatch = stripped == null ? null : matchRoutes(routeTable, stripped);
    currentParams = currentMatch?.params ?? {};
    currentSearchParams = new URLSearchParams(rawLocation.search);
    for (const listener of Array.from(listeners)) {
      listener();
    }
  };

  // ---- navigation ----------------------------------------------------

  const blockers = new Set<Blocker>();

  /** Current history stack index (mirrors `history.state.idx`). */
  let index = 0;

  /** Swallow the popstate echo produced by a blocker-rejected revert. */
  let revertingPop = false;

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
    const current = currentLocation;
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

    const current = currentLocation;
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
    void runBlockers(target, currentLocation).then((ok) => {
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
    get location() {
      return currentLocation;
    },
    get match() {
      return currentMatch;
    },
    get params() {
      return currentParams;
    },
    get searchParams() {
      return currentSearchParams;
    },
    navigate,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    block,
    dispose(): void {
      globalThis.removeEventListener("popstate", handlePop);
      blockers.clear();
      listeners.clear();
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
 * Resolve a router and subscribe the calling component to it: the component
 * re-renders after every committed navigation. Pass `router` explicitly, or
 * omit it to use the active router (the last `createRouter` result — throws
 * when none exists).
 *
 * The subscription starts in a post-commit effect, so the hook re-checks the
 * location immediately after subscribing (identity comparison against the
 * location this render saw) — a navigation that happened between render and
 * subscription still re-renders this component instead of being missed.
 */
export function useRouter(router?: RouterApi): RouterApi {
  const resolved = router ?? activeRouter;
  if (!resolved) {
    throw new Error("useRouter: no active router — call createRouter() first");
  }
  const [, force] = useState(0);
  const renderedLocation = useRef<Location>(resolved.location);
  renderedLocation.current = resolved.location;

  useEffect(() => {
    const check = (): void => {
      if (resolved.location !== renderedLocation.current) {
        force((tick) => tick + 1);
      }
    };
    const unsubscribe = resolved.subscribe(check);
    check();
    return unsubscribe;
  }, [resolved]);

  return resolved;
}

/**
 * Register a navigation blocker for this component's lifetime (react-router
 * `useBlocker`): registered on mount, unregistered on unmount. The blocker
 * closure is captured on the first render.
 *
 * Resolves the active router non-reactively — holding a blocker does not
 * re-render this component on navigation.
 */
export function useBlocker(blocker: Blocker): void {
  const captured = useRef(blocker);
  const router = useMemo(() => {
    if (!activeRouter) {
      throw new Error(
        "useBlocker: no active router — call createRouter() first",
      );
    }
    return activeRouter;
  }, []);
  useEffect(() => router.block(captured.current), []);
}

/**
 * Route outlet component: renders the matched route component (hostless —
 * the matched component's DOM splices directly into the parent). Pass
 * `router` explicitly, or omit it to use the active router.
 *
 * - Route change → the component swaps (old instance unmounted by the diff).
 * - Param-only change → SAME element type at the same position → same
 *   instance, hook state survives.
 * - `lazy` routes resolve once (in-flight dedup, cached on the route);
 *   nothing renders until the load lands. Load failures propagate as
 *   unhandled rejections — there is no swallowing.
 *
 * @example
 * const router = createRouter(routes);
 * render(<RouterView router={router} />, document.getElementById("root")!);
 */
export function RouterView(props: { router?: RouterApi }): VNode | null {
  const router = useRouter(props.router);
  const [, force] = useState(0); // bumped when a lazy load lands
  const m = router.match;

  // Kick off lazy loads when an unresolved route matches. No deps — runs
  // after every commit; the guards make it idempotent (resolved routes are
  // skipped, in-flight loads dedup through pendingLazy). The resolve
  // callback only forces a re-render: the body always re-derives from
  // router.match, so a stale load can never overwrite a newer route.
  useEffect(() => {
    if (!m || m.route.component || !m.route.lazy) return;
    const resolved = resolveRouteComponent(m.route);
    if (resolved instanceof Promise) {
      void resolved.then(() => force((tick) => tick + 1));
    }
  });

  const fn = m?.route.component;
  return fn ? createElement(fn, null) : null;
}
