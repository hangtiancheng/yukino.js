import { LitElement, html, nothing } from "lit";
import { customElement, property } from "../decorators";
import { jsx } from "../jsx-runtime";

export type NavigationState = "idle" | "loading" | "submitting";

export interface Navigation {
  state: NavigationState;
}

export const idleNavigation: Navigation = { state: "idle" };

export interface ActionArgs {
  request: Request;
  formData: FormData;
  params: Record<string, string>;
}

export type ActionFunctionArgs = ActionArgs;

export interface RouteProps {
  params: Record<string, string>;
  loaderData: unknown;
  actionData: unknown;
  navigation: Navigation;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RouteElement =
  ((props: any) => unknown) | (new (...args: any[]) => HTMLElement);

export interface LoaderArgs {
  request: Request;
  params: Record<string, string>;
}

export interface RouteConfig {
  index?: boolean;
  path?: string;
  to?: string;
  replace?: boolean;
  element?: RouteElement;
  loader?: (args: LoaderArgs) => unknown | Promise<unknown>;
  action?: (args: ActionArgs) => unknown | Promise<unknown>;
  children?: RouteConfig[];
}

export type RouteObject = RouteConfig;

interface FlatRoute {
  fullPath: string;
  isCatchAll: boolean;
  chain: RouteConfig[];
  leaf: RouteConfig;
  rank: number[];
}

function normalizePath(raw: string): string {
  let path = raw.replace(/^#/, "");
  const queryIndex = path.indexOf("?");
  if (queryIndex >= 0) path = path.slice(0, queryIndex);
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path === "" ? "/" : path;
}

function queryOf(rawHash: string): string {
  const path = rawHash.replace(/^#/, "");
  const queryIndex = path.indexOf("?");
  return queryIndex >= 0 ? path.slice(queryIndex + 1) : "";
}

function splitTo(to: string): { path: string; search: string } {
  const queryIndex = to.indexOf("?");
  return {
    path: normalizePath(to),
    search: queryIndex >= 0 ? to.slice(queryIndex + 1) : "",
  };
}

function joinPath(parent: string, child: string): string {
  if (child === "*") return `${parent === "/" ? "" : parent}/*`;
  const base = parent === "/" ? "" : parent;
  const seg = child.startsWith("/") ? child : `/${child}`;
  return normalizePath(`${base}${seg}`);
}

function rankPattern(pattern: string): number[] {
  return pattern
    .split("/")
    .filter(Boolean)
    .map((s) => (s === "*" ? 0 : s.startsWith(":") ? 2 : 3));
}

export function flatten(
  routes: RouteConfig[],
  parent = "",
  chain: RouteConfig[] = [],
): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const config of routes) {
    const currentChain = [...chain, config];
    const isRedirect = config.to !== undefined;
    const isWrapper = !!config.children?.length;

    if (!isWrapper || isRedirect) {
      const fullPath = config.index
        ? normalizePath(parent || "/")
        : joinPath(parent, config.path ?? "");
      out.push({
        fullPath,
        isCatchAll: config.path === "*",
        chain: currentChain,
        leaf: config,
        rank: rankPattern(fullPath),
      });
    }
    if (isWrapper && !isRedirect) {
      const basePath = config.index
        ? parent
        : joinPath(parent, config.path ?? "");
      out.push(...flatten(config.children!, basePath, currentChain));
    }
  }
  return out;
}

export function matchSegments(
  pattern: string,
  path: string,
): Record<string, string> | null {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    if (prefix === "" || path === prefix || path.startsWith(`${prefix}/`)) {
      return { "*": path.slice(prefix.length).replace(/^\//, "") };
    }
    return null;
  }
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const tp = pathParts[i];
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = decodeURIComponent(tp);
    } else if (pp !== tp) {
      return null;
    }
  }
  return params;
}

function compareRank(a: FlatRoute, b: FlatRoute): number {
  if (a.isCatchAll !== b.isCatchAll) return a.isCatchAll ? -1 : 1;
  const len = Math.max(a.rank.length, b.rank.length);
  for (let i = 0; i < len; i++) {
    const av = a.rank[i] ?? -1;
    const bv = b.rank[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  if (a.rank.length !== b.rank.length) return a.rank.length - b.rank.length;
  return 0;
}

export function bestMatch(
  flat: FlatRoute[],
  path: string,
): { route: FlatRoute; params: Record<string, string> } | null {
  const candidates: { route: FlatRoute; params: Record<string, string> }[] = [];
  for (const route of flat) {
    const params = matchSegments(route.fullPath, path);
    if (params) candidates.push({ route, params });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => compareRank(b.route, a.route));
  return candidates[0];
}

/* ------------------------------------------------------------------ */
/* Location adapters                                                   */
/* ------------------------------------------------------------------ */

export type RouterMode = "hash" | "history";

/**
 * Strategy describing where the router reads and writes the current
 * location. `HashLocation` keeps the route in `location.hash` (works on
 * any static host), `HistoryLocation` uses the real pathname via the
 * History API (needs server-side fallback to the app shell).
 */
export interface LocationAdapter {
  readonly mode: RouterMode;
  /** Current route path (query excluded); the router normalizes it. */
  getPath(): string;
  /** Current query string without the leading `?`. */
  getSearch(): string;
  /** Value for `<a href>` rendering. */
  createHref(path: string, search?: string): string;
  /** Absolute URL used to build loader/action `Request` objects. */
  requestUrl(path: string, search?: string): string;
  /** Subscribe to external navigation (back/forward, manual hash edits). */
  listen(onChange: () => void): () => void;
  /**
   * Apply a new URL. Return `true` when the browser will asynchronously
   * fire a change event on its own (hash navigation), `false` when the
   * router must resolve immediately (History API never fires popstate).
   */
  push(path: string, search: string): boolean;
  /** Replace the current URL entry; same event contract as `push`. */
  replace(path: string, search: string): boolean;
}

export class HashLocation implements LocationAdapter {
  readonly mode = "hash" as const;

  getPath(): string {
    return window.location.hash.slice(1);
  }

  getSearch(): string {
    return queryOf(window.location.hash || "");
  }

  createHref(path: string, search = ""): string {
    return `#${path}${search ? `?${search}` : ""}`;
  }

  requestUrl(path: string, search = ""): string {
    return `${window.location.origin}${window.location.pathname}${path}${search ? `?${search}` : ""}`;
  }

  listen(onChange: () => void): () => void {
    const handler = () => onChange();
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }

  push(path: string, search: string): boolean {
    const href = this.createHref(path, search);
    if (window.location.hash === href) return false;
    window.location.hash = href; // fires hashchange asynchronously
    return true;
  }

  replace(path: string, search: string): boolean {
    const url = `${window.location.pathname}${window.location.search}${this.createHref(path, search)}`;
    window.history.replaceState(null, "", url);
    return false;
  }
}

export class HistoryLocation implements LocationAdapter {
  readonly mode = "history" as const;

  getPath(): string {
    return window.location.pathname;
  }

  getSearch(): string {
    return window.location.search.replace(/^\?/, "");
  }

  createHref(path: string, search = ""): string {
    return `${path}${search ? `?${search}` : ""}`;
  }

  requestUrl(path: string, search = ""): string {
    return `${window.location.origin}${path}${search ? `?${search}` : ""}`;
  }

  listen(onChange: () => void): () => void {
    const handler = () => onChange();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }

  push(path: string, search: string): boolean {
    window.history.pushState(null, "", this.createHref(path, search));
    return false; // pushState never fires popstate
  }

  replace(path: string, search: string): boolean {
    window.history.replaceState(null, "", this.createHref(path, search));
    return false;
  }
}

export const hashLocation = new HashLocation();
export const historyLocation = new HistoryLocation();

/* ------------------------------------------------------------------ */
/* Router core                                                         */
/* ------------------------------------------------------------------ */

interface Match {
  chain: RouteConfig[];
  params: Record<string, string>;
  leaf: RouteConfig;
}

export class Router {
  private flat: FlatRoute[] = [];
  private match: Match | null = null;
  private loaderData: unknown = undefined;
  private actionData: unknown = undefined;
  private navigation: Navigation = idleNavigation;
  private started = false;
  private unlisten?: () => void;
  private readonly bus = new window.EventTarget();
  private currentPath = "/";
  private resolveToken = 0;
  private adapter: LocationAdapter;

  constructor(adapter: LocationAdapter = hashLocation) {
    this.adapter = adapter;
  }

  /** Active location strategy (`"hash"` or `"history"`). */
  get mode(): RouterMode {
    return this.adapter.mode;
  }

  /**
   * Swap the location strategy. Safe before or after `start()`; when the
   * router is already running the old change listener is detached and the
   * new one attached.
   */
  use(adapter: LocationAdapter): this {
    if (adapter === this.adapter) return this;
    this.adapter = adapter;
    if (this.started) {
      this.unlisten?.();
      this.unlisten = adapter.listen(() => void this.resolve(this.getPath()));
    }
    return this;
  }

  configure(routes: RouteConfig[]): this {
    this.flat = flatten(routes);
    if (this.started) void this.resolve(this.getPath());
    return this;
  }

  start(): this {
    if (this.started) return this;
    this.started = true;
    this.unlisten = this.adapter.listen(
      () => void this.resolve(this.getPath()),
    );
    void this.resolve(this.getPath());
    return this;
  }

  /** Detach the URL listener (re-`start()` to resume). */
  stop(): this {
    this.unlisten?.();
    this.unlisten = undefined;
    this.started = false;
    return this;
  }

  getPath(): string {
    return normalizePath(this.adapter.getPath());
  }

  getSearch(): string {
    return this.adapter.getSearch();
  }

  /** Render-ready href for a route target, in the active mode. */
  createHref(to: string): string {
    const { path, search } = splitTo(to);
    return this.adapter.createHref(path, search);
  }

  onChange(cb: () => void): () => void {
    this.bus.addEventListener("change", cb);
    return () => this.bus.removeEventListener("change", cb);
  }

  invalidate(): void {
    this.bus.dispatchEvent(new window.Event("change"));
  }

  private getParams(): Record<string, string> {
    return this.match ? this.match.params : {};
  }

  private loaderArgs(params: Record<string, string>): LoaderArgs {
    return {
      request: new Request(
        this.adapter.requestUrl(this.currentPath, this.getSearch()),
      ),
      params,
    };
  }

  private async resolve(rawPath: string): Promise<void> {
    const path = normalizePath(rawPath);
    this.currentPath = path;
    const token = ++this.resolveToken;
    const found = bestMatch(this.flat, path);
    if (!found) {
      this.match = null;
      this.loaderData = undefined;
      this.actionData = undefined;
      this.navigation = idleNavigation;
      this.invalidate();
      return;
    }
    const { route, params } = found;
    const leaf = route.leaf;

    if (leaf.to !== undefined) {
      this.navigate(leaf.to, { replace: leaf.replace !== false });
      return;
    }

    this.match = { chain: route.chain, params, leaf };

    if (leaf.loader) {
      this.navigation = { state: "loading" };
      this.invalidate();
      let data: unknown;
      try {
        data = await leaf.loader(this.loaderArgs(params));
      } catch (error) {
        data = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (token !== this.resolveToken) return;
      this.loaderData = data;
      this.actionData = undefined;
      this.navigation = idleNavigation;
      this.invalidate();
    } else {
      this.loaderData = undefined;
      this.actionData = undefined;
      this.navigation = idleNavigation;
      this.invalidate();
    }
  }

  navigate(to: string, opts: { replace?: boolean } = {}): void {
    const { path, search } = splitTo(to);
    const fired = opts.replace
      ? this.adapter.replace(path, search)
      : this.adapter.push(path, search);
    if (!fired) void this.resolve(path);
  }

  async runAction(
    formData: FormData,
    opts: { method?: string } = {},
  ): Promise<unknown> {
    const leaf = this.match?.leaf;
    const action = leaf?.action;
    if (!leaf || !action) return undefined;
    const params = this.getParams();
    const request = new Request(this.adapter.requestUrl(this.currentPath), {
      method: (opts.method ?? "post").toUpperCase(),
      body: formData,
    });
    this.navigation = { state: "submitting" };
    this.invalidate();
    let actionData: unknown;
    try {
      actionData = await action({ request, formData, params });
    } catch (error) {
      actionData = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.actionData = actionData;
    if (leaf.loader) {
      this.navigation = { state: "loading" };
      this.invalidate();
      try {
        this.loaderData = await leaf.loader(this.loaderArgs(params));
      } catch (error) {
        this.loaderData = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    this.navigation = idleNavigation;
    this.invalidate();
    return actionData;
  }

  submit(formData: FormData, opts?: { method?: string }): Promise<unknown> {
    return this.runAction(formData, opts);
  }

  get state(): {
    path: string;
    params: Record<string, string>;
    loaderData: unknown;
    actionData: unknown;
    navigation: Navigation;
  } {
    return {
      path: this.currentPath,
      params: this.getParams(),
      loaderData: this.loaderData,
      actionData: this.actionData,
      navigation: this.navigation,
    };
  }

  render(): unknown {
    if (!this.match) return null;
    const first = this.match.chain[0];
    if (!first.element) return null;
    if (first === this.match.leaf) return this.renderLeaf();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return jsx(first.element as any, {});
  }

  renderAt(index: number): unknown {
    if (!this.match) return null;
    const config = this.match.chain[index];
    if (!config?.element) return null;
    if (config === this.match.leaf) return this.renderLeaf();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return jsx(config.element as any, {});
  }

  renderLeaf(): unknown {
    if (!this.match) return null;
    const leaf = this.match.leaf;
    if (!leaf.element) return null;
    return jsx(leaf.element, {
      params: this.getParams(),
      loaderData: this.loaderData,
      actionData: this.actionData,
      navigation: this.navigation,
    });
  }
}

/**
 * Shared router instance. All hooks and the `<route-view>` /
 * `<route-outlet>` elements are bound to it; pick a mode with
 * `createHashRouter` or `createBrowserRouter`.
 */
export const router = new Router(hashLocation);

/** Route from the URL hash (`#/path`); works on any static host. */
export function createHashRouter(routes: RouteConfig[]): Router {
  router.use(hashLocation);
  router.configure(routes);
  router.start();
  return router;
}

/** Route from the real pathname (`/path`) via the History API. */
export function createBrowserRouter(routes: RouteConfig[]): Router {
  router.use(historyLocation);
  router.configure(routes);
  router.start();
  return router;
}

/** Alias of `createBrowserRouter`. */
export const createHistoryRouter = createBrowserRouter;

export function navigate(to: string, opts?: { replace?: boolean }): void {
  router.navigate(to, opts);
}

export function useParams(): Record<string, string> {
  return router.state.params;
}

export function useLocation(): { pathname: string; search: string } {
  const search = router.getSearch();
  return { pathname: router.state.path, search: search ? `?${search}` : "" };
}

export function useNavigate(): (
  to: string,
  opts?: { replace?: boolean },
) => void {
  return navigate;
}

export function useNavigation(): Navigation {
  return router.state.navigation;
}

export function useLoaderData<T = unknown>(): T {
  return router.state.loaderData as T;
}

export function useActionData<T = unknown>(): T | undefined {
  return router.state.actionData as T | undefined;
}

export function useSearchParams(): [
  URLSearchParams,
  (
    next: URLSearchParams | Record<string, string>,
    opts?: { replace?: boolean },
  ) => void,
] {
  const params = new URLSearchParams(router.getSearch());
  const set = (
    next: URLSearchParams | Record<string, string>,
    opts?: { replace?: boolean },
  ) => {
    const sp =
      next instanceof URLSearchParams ? next : new URLSearchParams(next);
    const query = sp.toString();
    router.navigate(`${router.state.path}${query ? `?${query}` : ""}`, {
      replace: opts?.replace,
    });
  };
  return [params, set];
}

export function useMatch(
  pattern: string,
): { params: Record<string, string> } | null {
  const params = matchSegments(pattern, router.state.path);
  return params ? { params } : null;
}

let outletContext: unknown = undefined;

export function setOutletContext(value: unknown): void {
  outletContext = value;
}

export function useOutletContext<T = unknown>(): T {
  return outletContext as T;
}

export class RoutedElement extends LitElement {
  private unsubscribe?: () => void;

  override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
    this.unsubscribe = router.onChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }
}

export function Outlet(depth = 0): unknown {
  return html`<route-outlet depth=${depth}></route-outlet>`;
}

export class Fetcher<T = unknown> {
  state: NavigationState = "idle";
  data: T | undefined = undefined;
  private readonly notify: () => void;

  constructor(notify: () => void) {
    this.notify = notify;
  }

  async submit(
    formData: FormData,
    opts: { method?: string } = {},
  ): Promise<void> {
    this.state = "submitting";
    this.notify();
    try {
      this.data = (await router.runAction(formData, opts)) as T;
    } catch (error) {
      this.data = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      } as T;
    }
    this.state = "idle";
    this.notify();
  }
}

type ToTarget = string | { pathname?: string; search?: string };

function resolveTo(to: ToTarget): string {
  if (typeof to === "string") return to;
  const pathname = to.pathname ?? router.state.path;
  const search = to.search ?? "";
  return `${pathname}${search ? (search.startsWith("?") ? search : `?${search}`) : ""}`;
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

export function Link(props: {
  to: ToTarget;
  className?: string;
  ariaLabel?: string;
  title?: string;
  children?: unknown;
}): unknown {
  const { to, className, ariaLabel, title, children } = props;
  return jsx("a", {
    href: router.createHref(resolveTo(to)),
    ...(className !== undefined ? { className } : {}),
    ...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {}),
    ...(title !== undefined ? { title } : {}),
    onClick: (event: MouseEvent) => {
      if (!isPlainLeftClick(event)) return;
      event.preventDefault();
      navigate(resolveTo(to));
    },
    children,
  });
}

export function NavLink(props: {
  to: ToTarget;
  end?: boolean;
  className?: string | ((state: { isActive: boolean }) => string);
  children?: unknown;
}): unknown {
  const { to, end = false, className, children } = props;
  const target = normalizePath(resolveTo(to));
  const current = router.state.path;
  const isActive =
    target === "/"
      ? end
        ? current === "/"
        : true
      : current === target || (!end && current.startsWith(`${target}/`));
  const cls =
    typeof className === "function" ? className({ isActive }) : className;
  return jsx("a", {
    href: router.createHref(resolveTo(to)),
    ...(cls !== undefined ? { className: cls } : {}),
    ...(isActive ? { "aria-current": "page" } : {}),
    onClick: (event: MouseEvent) => {
      if (!isPlainLeftClick(event)) return;
      event.preventDefault();
      navigate(resolveTo(to));
    },
    children,
  });
}

export function Form(props: {
  method?: string;
  className?: string;
  children?: unknown;
  onSubmit?: (formData: FormData, method: string) => void;
}): unknown {
  const { method = "post", className, children, onSubmit } = props;
  return jsx("form", {
    ...(className !== undefined ? { className } : {}),
    onSubmit: (event: SubmitEvent) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const formData = new FormData(form);
      if (onSubmit) {
        onSubmit(formData, method);
      } else {
        void router.submit(formData, { method });
      }
    },
    children,
  });
}

@customElement("route-view")
export class RouteView extends RoutedElement {
  protected override render(): unknown {
    return router.render() ?? nothing;
  }
}

@customElement("route-outlet")
export class RouteOutlet extends RoutedElement {
  @property({ type: Number }) depth = 0;

  protected override render(): unknown {
    return router.renderAt(this.depth + 1) ?? nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "route-view": RouteView;
    "route-outlet": RouteOutlet;
  }
}
