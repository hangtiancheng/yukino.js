import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitElement, html, nothing, render } from "lit";
import { jsx } from "@/jsx-runtime";
import {
  Fetcher,
  Form,
  Link,
  NavLink,
  Outlet,
  bestMatch,
  createBrowserRouter,
  createHashRouter,
  flatten,
  hashLocation,
  historyLocation,
  matchSegments,
  navigate,
  router,
  useLocation,
  useMatch,
  useParams,
  useSearchParams,
  type RouteConfig,
  type RouteProps,
} from "@/community/router";

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Home() {
  return html`<div id="home">home</div>`;
}

function User(props: RouteProps) {
  return html`<div id="user">
    user:${props.params.id}:${String(props.loaderData ?? "")}
  </div>`;
}

function Layout() {
  return html`<div id="layout">layout<route-outlet></route-outlet></div>`;
}

function List() {
  return html`<div id="list">list</div>`;
}

function NotFound() {
  return html`<div id="not-found">404</div>`;
}

const routes: RouteConfig[] = [
  { path: "/", element: Home },
  { path: "/list", element: List },
  {
    path: "/users",
    element: Layout,
    children: [
      { index: true, element: Home },
      {
        path: ":id",
        element: User,
        loader: ({ params }) => `loaded-${params.id}`,
      },
    ],
  },
  { path: "/old", to: "/" },
  { path: "*", element: NotFound },
];

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  router.stop();
  render(nothing, container);
  container.remove();
});

describe("route matching", () => {
  it("ranks static segments over params over catch-all", () => {
    const flat = flatten([
      { path: "*" },
      { path: "/users/:id" },
      { path: "/users/me" },
    ]);
    expect(bestMatch(flat, "/users/me")!.route.fullPath).toBe("/users/me");
    expect(bestMatch(flat, "/users/42")!.params).toEqual({ id: "42" });
    expect(bestMatch(flat, "/zzz")!.route.fullPath).toBe("/*");
  });

  it("matches catch-all and param segments", () => {
    expect(matchSegments("/docs/*", "/docs/a/b")).toEqual({ "*": "a/b" });
    expect(matchSegments("/docs/*", "/docs")).toEqual({ "*": "" });
    expect(matchSegments("/docs/*", "/other")).toBeNull();
    expect(matchSegments("/users/:id", "/users/4%20x")).toEqual({ id: "4 x" });
  });

  it("matches params before a splat and tolerates malformed URL escapes", () => {
    expect(matchSegments("/users/:id/*", "/users/4%20x/docs/a")).toEqual({
      id: "4 x",
      "*": "docs/a",
    });
    expect(matchSegments("/users/:id", "/users/bad%escape")).toEqual({
      id: "bad%escape",
    });
  });

  it("prefers an exact route to its empty splat and supports parent routes", () => {
    const flat = flatten([
      { path: "/docs/*" },
      { path: "/docs", element: Layout, children: [{ path: "new" }] },
    ]);
    expect(bestMatch(flat, "/docs")!.route.fullPath).toBe("/docs");
    expect(bestMatch(flat, "/docs/new")!.route.fullPath).toBe("/docs/new");
  });

  it("ranks static splat prefixes above params and index routes above parents", () => {
    const flat = flatten([
      { path: "/:group/:id" },
      { path: "/docs/*" },
      {
        path: "/",
        element: Layout,
        children: [{ index: true, element: Home }],
      },
    ]);
    expect(bestMatch(flat, "/docs/readme")!.route.fullPath).toBe("/docs/*");
    expect(bestMatch(flat, "/")!.route.leaf.element).toBe(Home);
  });

  it("does not prefix absolute child paths a second time", () => {
    const flat = flatten([
      { path: "/users", children: [{ path: "/users/:id" }] },
    ]);
    expect(bestMatch(flat, "/users/42")!.params).toEqual({ id: "42" });
  });
});

describe("nested outlets", () => {
  it("renders the documented JSX Outlet and skips routes without elements", async () => {
    createBrowserRouter([
      {
        children: [
          {
            path: "/",
            element: () => html`<main>${jsx(Outlet, {})}</main>`,
            children: [{ index: true, element: Home }],
          },
        ],
      },
    ]);
    render(html`<route-view></route-view>`, container);
    await settle();
    expect(container.querySelector("main #home")).toBeTruthy();
  });

  it("infers the next level for nested outlets", async () => {
    createBrowserRouter([
      {
        path: "/",
        element: Layout,
        children: [
          {
            path: "users",
            element: () => html`<section>${jsx(Outlet, {})}</section>`,
            children: [{ path: ":id", element: User }],
          },
        ],
      },
    ]);
    navigate("/users/42");
    render(html`<route-view></route-view>`, container);
    await settle();
    expect(container.querySelector("#layout section #user")).toBeTruthy();
  });

  it("supports explicit depth and infers depth across shadow DOM layouts", async () => {
    class ShadowLayout extends LitElement {
      protected override render() {
        return html`${jsx(Outlet, {})}`;
      }
    }
    customElements.define("review-shadow-layout", ShadowLayout);
    createBrowserRouter([
      {
        path: "/",
        element: () => html`${Outlet(0)}`,
        children: [
          {
            path: "users",
            element: ShadowLayout,
            children: [{ index: true, element: Home }],
          },
        ],
      },
    ]);
    navigate("/users");
    render(html`<route-view></route-view>`, container);
    await settle();
    expect(
      container
        .querySelector("review-shadow-layout")!
        .shadowRoot!.querySelector("#home"),
    ).toBeTruthy();
  });
});

describe("hash router", () => {
  it("renders the matched route and navigates via hash", async () => {
    createHashRouter(routes);
    render(html`<route-view></route-view>`, container);
    await settle();
    expect(container.querySelector("#home")).toBeTruthy();
    expect(router.mode).toBe("hash");

    navigate("/users/42");
    await settle();
    expect(window.location.hash).toBe("#/users/42");
    const layout = container.querySelector("#layout");
    expect(layout).toBeTruthy();
    expect(layout!.querySelector("#user")!.textContent!.trim()).toBe(
      "user:42:loaded-42",
    );
    expect(useParams()).toEqual({ id: "42" });
    expect(useMatch("/users/:id")).toEqual({ params: { id: "42" } });
    expect(useMatch("/other/:id")).toBeNull();
  });

  it("follows redirect routes", async () => {
    createHashRouter(routes);
    render(html`<route-view></route-view>`, container);
    navigate("/old");
    await settle();
    expect(window.location.hash).toBe("#/");
    expect(container.querySelector("#home")).toBeTruthy();
  });

  it("exposes search params from the hash", async () => {
    createHashRouter(routes);
    render(html`<route-view></route-view>`, container);
    navigate("/list?q=abc&n=1");
    await settle();
    expect(window.location.hash).toBe("#/list?q=abc&n=1");
    const [searchParams, setSearchParams] = useSearchParams();
    expect(searchParams.get("q")).toBe("abc");
    expect(useLocation()).toEqual({ pathname: "/list", search: "?q=abc&n=1" });

    setSearchParams({ q: "xyz" });
    await settle();
    expect(window.location.hash).toBe("#/list?q=xyz");
  });

  it("falls back to the catch-all route", async () => {
    createHashRouter(routes);
    render(html`<route-view></route-view>`, container);
    navigate("/nope/deep");
    await settle();
    expect(container.querySelector("#not-found")).toBeTruthy();
  });

  it("renders link hrefs with a hash prefix", async () => {
    createHashRouter(routes);
    render(
      html`<div>${Link({ to: "/users/3", children: "go" })}</div>`,
      container,
    );
    expect(container.querySelector("a")!.getAttribute("href")).toBe(
      "#/users/3",
    );
  });
});

describe("history router", () => {
  it("renders and navigates via pushState", async () => {
    createBrowserRouter(routes);
    render(html`<route-view></route-view>`, container);
    await settle();
    expect(container.querySelector("#home")).toBeTruthy();
    expect(router.mode).toBe("history");

    navigate("/users/7");
    await settle();
    expect(window.location.pathname).toBe("/users/7");
    expect(window.location.hash).toBe("");
    expect(container.querySelector("#user")!.textContent!.trim()).toBe(
      "user:7:loaded-7",
    );
  });

  it("re-resolves on popstate (back/forward)", async () => {
    createBrowserRouter(routes);
    render(html`<route-view></route-view>`, container);
    await settle();
    navigate("/users/1");
    await settle();
    expect(container.querySelector("#user")).toBeTruthy();

    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await settle();
    expect(container.querySelector("#home")).toBeTruthy();
  });

  it("keeps search params in the real query string", async () => {
    createBrowserRouter(routes);
    render(html`<route-view></route-view>`, container);
    navigate("/list?q=zzz");
    await settle();
    expect(window.location.search).toBe("?q=zzz");
    expect(useLocation()).toEqual({ pathname: "/list", search: "?q=zzz" });
  });

  it("renders link hrefs without a hash prefix", async () => {
    createBrowserRouter(routes);
    render(
      html`<div>
        ${Link({ to: { pathname: "/users/3", search: "tab=1" }, children: "go" })}
      </div>`,
      container,
    );
    expect(container.querySelector("a")!.getAttribute("href")).toBe(
      "/users/3?tab=1",
    );
  });
});

describe("mode switching", () => {
  it("resolves the new location when use() changes the adapter directly", async () => {
    createHashRouter(routes);
    navigate("/list");
    await settle();
    router.use(historyLocation);
    expect(router.state.path).toBe("/");
    router.use(hashLocation);
    expect(router.state.path).toBe("/list");
  });

  it("reconfigures atomically without replaying redirects from old routes", async () => {
    createHashRouter([
      { path: "/", element: Home },
      { path: "*", to: "/" },
    ]);
    window.history.replaceState(null, "", "/list#/");
    const loader = vi.fn(() => "data");
    createBrowserRouter([{ path: "/list", loader }]);
    await settle();
    expect(window.location.pathname).toBe("/list");
    expect(router.state.path).toBe("/list");
    expect(loader).toHaveBeenCalledOnce();
  });

  it("switches from hash to history mode", async () => {
    createHashRouter(routes);
    render(html`<route-view></route-view>`, container);
    navigate("/users/9");
    await settle();
    expect(window.location.hash).toBe("#/users/9");

    createBrowserRouter(routes);
    expect(router.mode).toBe("history");
    await settle();
    // the pathname (not the stale hash) drives matching now
    expect(container.querySelector("#home")).toBeTruthy();

    window.history.replaceState(null, "", "/users/2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();
    expect(container.querySelector("#user")!.textContent!.trim()).toBe(
      "user:2:loaded-2",
    );
  });
});

describe("redirect and navigation lifecycle", () => {
  it("refreshes a route-view reconnected after navigation", async () => {
    createBrowserRouter(routes);
    const view = document.createElement("route-view");
    container.appendChild(view);
    await settle();
    expect(view.querySelector("#home")).toBeTruthy();
    view.remove();
    navigate("/list");
    container.appendChild(view);
    await settle();
    expect(view.querySelector("#list")).toBeTruthy();
  });

  for (const create of [createHashRouter, createBrowserRouter]) {
    it(`stops redirect cycles in ${create.name}`, async () => {
      create([
        { path: "/", to: "/loop", replace: false },
        { path: "/loop", to: "/", replace: false },
        { path: "/list", element: List },
      ]);
      await settle();
      expect(router.render()).toBeNull();
      expect(router.state.navigation.state).toBe("idle");
      navigate("/list");
      await settle();
      expect(router.state.path).toBe("/list");
    });
  }

  it("resolves redirect chains once, including queries", async () => {
    const loader = vi.fn(
      ({ request }: { request: Request }) => new URL(request.url).search,
    );
    createHashRouter([
      { path: "/", to: "/old" },
      { path: "/old", to: "/list?q=ok", replace: false },
      { path: "/list", loader },
    ]);
    await settle();
    expect(window.location.hash).toBe("#/list?q=ok");
    expect(router.state.loaderData).toBe("?q=ok");
    expect(loader).toHaveBeenCalledOnce();
  });

  it("drops old loader results before hashchange fires and clears data while loading", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    createHashRouter([
      { path: "/", loader: () => first.promise },
      { path: "/list", loader: () => second.promise },
    ]);
    navigate("/list");
    first.resolve("stale");
    await Promise.resolve();
    expect(router.state.loaderData).toBeUndefined();
    await settle();
    expect(router.state.navigation.state).toBe("loading");
    second.resolve("new");
    await settle();
    expect(router.state.loaderData).toBe("new");
  });

  it("marks the root NavLink inactive away from the root", () => {
    createBrowserRouter(routes);
    navigate("/list");
    render(
      NavLink({
        to: "/",
        className: ({ isActive }) => (isActive ? "active" : ""),
      }) as never,
      container,
    );
    const link = container.querySelector("a")!;
    expect(link.hasAttribute("aria-current")).toBe(false);
    expect(link.className).toBe("");
  });
});

describe("actions", () => {
  it("does not commit action results after navigating to a different route", async () => {
    let finishAction!: (value: string) => void;
    const oldLoader = vi.fn(() => "old loader");
    createBrowserRouter([
      {
        path: "/",
        action: () =>
          new Promise<string>((resolve) => {
            finishAction = resolve;
          }),
        loader: oldLoader,
      },
      { path: "/list", loader: () => "new loader" },
    ]);
    await settle();
    const pending = router.submit(new FormData());
    navigate("/list");
    await settle();
    finishAction("stale action");
    expect(await pending).toBe("stale action");
    expect(router.state.path).toBe("/list");
    expect(router.state.loaderData).toBe("new loader");
    expect(router.state.actionData).toBeUndefined();
    expect(oldLoader).toHaveBeenCalledOnce();
  });

  it("does not commit a stale action revalidation or leave a stopped loader running", async () => {
    let finishLoader!: (value: string) => void;
    let calls = 0;
    createBrowserRouter([
      {
        path: "/",
        action: () => "action",
        loader: () =>
          ++calls === 1
            ? "initial"
            : new Promise<string>((resolve) => {
                finishLoader = resolve;
              }),
      },
      { path: "/list", loader: () => "new loader" },
    ]);
    await settle();
    const pending = router.submit(new FormData());
    await Promise.resolve();
    navigate("/list");
    await settle();
    finishLoader("stale loader");
    await pending;
    expect(router.state.loaderData).toBe("new loader");
    expect(router.state.actionData).toBeUndefined();

    navigate("/");
    router.stop();
    finishLoader("after stop");
    await Promise.resolve();
    expect(router.state.loaderData).not.toBe("after stop");
  });

  it("keeps query parameters in action and revalidation requests", async () => {
    const seen: string[] = [];
    window.history.replaceState(null, "", "/?tab=2");
    createBrowserRouter([
      {
        path: "/",
        loader: ({ request }) => {
          seen.push(request.url);
        },
        action: ({ request }) => {
          seen.push(request.url);
        },
      },
    ]);
    await settle();
    await router.submit(new FormData());
    expect(seen.map((url) => new URL(url).search)).toEqual([
      "?tab=2",
      "?tab=2",
      "?tab=2",
    ]);
  });

  it("submits GET forms as query navigation and includes the submitter", async () => {
    const action = vi.fn();
    createBrowserRouter([{ path: "/", action }]);
    render(
      Form({
        method: "get",
        children: html`<input name="q" value="lit" /><button
            name="intent"
            value="search"
          >
            Search
          </button>`,
      }) as never,
      container,
    );
    const form = container.querySelector("form")!;
    const button = container.querySelector("button")!;
    form.dispatchEvent(
      new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: button,
      }),
    );
    await settle();
    expect(window.location.search).toBe("?q=lit&intent=search");
    expect(action).not.toHaveBeenCalled();
  });

  it("runs the matched route action via submit", async () => {
    let seen: string | undefined;
    createHashRouter([
      {
        path: "/",
        element: Home,
        action: async ({ formData }) => {
          seen = String(formData.get("name"));
          return { ok: true, seen };
        },
      },
    ]);
    render(html`<route-view></route-view>`, container);
    await settle();
    const formData = new FormData();
    formData.append("name", "yukino");
    const result = await router.submit(formData);
    expect(seen).toBe("yukino");
    expect(result).toEqual({ ok: true, seen: "yukino" });
    expect(router.state.actionData).toEqual({ ok: true, seen: "yukino" });
  });

  it("Fetcher wraps action results", async () => {
    createHashRouter([
      { path: "/", element: Home, action: () => ({ ok: true }) },
    ]);
    render(html`<route-view></route-view>`, container);
    await settle();
    let notified = 0;
    const fetcher = new Fetcher<{ ok: boolean }>(() => {
      notified++;
    });
    await fetcher.submit(new FormData());
    expect(fetcher.state).toBe("idle");
    expect(fetcher.data).toEqual({ ok: true });
    expect(notified).toBeGreaterThanOrEqual(2);
  });

  it("keeps the latest Fetcher submission when responses arrive out of order", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    createBrowserRouter([
      {
        path: "/",
        action: () => (++calls === 1 ? first.promise : second.promise),
      },
    ]);
    const fetcher = new Fetcher<string>(() => {});
    const a = fetcher.submit(new FormData());
    const b = fetcher.submit(new FormData());
    second.resolve("new");
    await b;
    first.resolve("old");
    await a;
    expect(fetcher.data).toBe("new");
    expect(router.state.actionData).toBe("new");
  });
});
