/** App boot story: render(<RouterView router={createRouter(routes)}/>, el). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRouter,
  render,
  RouterView,
  useBlocker,
  useRouter,
  useState,
} from "@yukino.js/react";
import type { RouterApi } from "@yukino.js/react";
import { click, flush } from "./helpers";

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

function Home() {
  return <p>home</p>;
}

function About() {
  return <p>about</p>;
}

function NotFound() {
  return <p>404</p>;
}

function UserDetail() {
  const { id } = useRouter().params;
  const [clicks, setClicks] = useState(0);
  return (
    <button onClick={() => setClicks((c) => c + 1)}>
      {`user ${id} clicks ${clicks}`}
    </button>
  );
}

let host: HTMLElement;
let router: RouterApi | undefined;

beforeEach(() => {
  globalThis.history.replaceState(null, "", "/");
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  router?.dispose();
  router = undefined;
});

describe("RouterView", () => {
  it("renders the matched route component into the container (hostless)", () => {
    router = createRouter([{ path: "/", component: Home }]);
    render(<RouterView router={router} />, host);
    expect(host.innerHTML).toBe("<p>home</p>");
  });

  it("falls back to the active router when no router prop is given", () => {
    router = createRouter([{ path: "/", component: Home }]);
    render(<RouterView />, host);
    expect(host.innerHTML).toBe("<p>home</p>");
  });

  it("re-renders on navigation and falls back to the splat route", async () => {
    router = createRouter([
      { path: "/", component: Home },
      { path: "/about", component: About },
      { path: "*", component: NotFound },
    ]);
    render(<RouterView router={router} />, host);
    await router.navigate("/about");
    expect(host.innerHTML).toBe("<p>about</p>");
    await router.navigate("/missing/deep");
    expect(host.innerHTML).toBe("<p>404</p>");
    await router.navigate("/");
    expect(host.innerHTML).toBe("<p>home</p>");
  });

  it("renders nothing when no route matches", async () => {
    router = createRouter([{ path: "/", component: Home }]);
    render(<RouterView router={router} />, host);
    await router.navigate("/nowhere");
    expect(host.innerHTML).toBe("");
  });

  it("keeps the same instance (hook state) across param-only navigations", async () => {
    router = createRouter([{ path: "/users/:id", component: UserDetail }]);
    await router.navigate("/users/1");
    render(<RouterView router={router} />, host);
    expect(host.innerHTML).toBe("<button>user 1 clicks 0</button>");

    click(host.querySelector("button")!);
    await flush();
    expect(host.innerHTML).toBe("<button>user 1 clicks 1</button>");

    // Param-only change: same component → same instance → clicks survive.
    await router.navigate("/users/2");
    expect(host.innerHTML).toBe("<button>user 2 clicks 1</button>");
  });

  it("loads lazy routes once (dedup + cached on the route)", async () => {
    let loads = 0;
    router = createRouter([
      { path: "/", component: Home },
      {
        path: "/admin",
        lazy: () => {
          loads++;
          return Promise.resolve({ default: About });
        },
      },
    ]);
    render(<RouterView router={router} />, host);
    await router.navigate("/admin");
    await poll(() => host.innerHTML === "<p>about</p>");
    await router.navigate("/");
    await router.navigate("/admin");
    expect(host.innerHTML).toBe("<p>about</p>");
    expect(loads).toBe(1);
  });

  it("a stale lazy load never overwrites a newer route", async () => {
    let release!: () => void;
    router = createRouter([
      { path: "/", component: Home },
      {
        path: "/slow",
        lazy: () =>
          new Promise((resolve) => {
            release = (): void => resolve({ default: About });
          }),
      },
    ]);
    render(<RouterView router={router} />, host);
    await router.navigate("/slow");
    await router.navigate("/"); // newer navigation wins
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(host.innerHTML).toBe("<p>home</p>");
  });

  it("honors basename for matching", async () => {
    globalThis.history.replaceState(null, "", "/app/");
    router = createRouter(
      [
        { path: "/", component: Home },
        { path: "/about", component: About },
      ],
      { basename: "/app" },
    );
    render(<RouterView router={router} />, host);
    expect(host.innerHTML).toBe("<p>home</p>");
    await router.navigate("/about");
    expect(globalThis.location.pathname).toBe("/app/about");
    expect(host.innerHTML).toBe("<p>about</p>");
  });
});

describe("useBlocker", () => {
  it("blocks while mounted, unblocks on unmount", async () => {
    router = createRouter([{ path: "*", component: NotFound }]);
    function Guarded() {
      useBlocker(() => false);
      return <p>guarded</p>;
    }
    render(<Guarded />, host);
    expect(await router.navigate("/away")).toBe(false);
    render(null, host);
    expect(await router.navigate("/away")).toBe(true);
  });
});
