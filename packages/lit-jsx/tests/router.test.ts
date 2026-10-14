import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { html, nothing, render } from "lit";
import {
  Fetcher,
  Link,
  bestMatch,
  createBrowserRouter,
  createHashRouter,
  flatten,
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
    expect(layout!.querySelector("#user")!.textContent).toBe(
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
    expect(container.querySelector("#user")!.textContent).toBe(
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
    expect(container.querySelector("#user")!.textContent).toBe(
      "user:2:loaded-2",
    );
  });
});

describe("actions", () => {
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
});
