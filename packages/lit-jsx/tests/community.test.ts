import { afterEach, describe, expect, it } from "vitest";
import { html, render } from "lit";
import type { TemplateResult } from "lit";
import litSvg from "@/assets/lit.svg?raw";
import { PoweredByLit } from "@/community/powered-by";
import { icon, iconWith } from "@/community/icon";
import * as community from "@/community";

let container: HTMLDivElement;

afterEach(() => {
  if (container) {
    render(html``, container);
    container.remove();
  }
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("?raw imports", () => {
  it("imports file contents as a string", () => {
    expect(typeof litSvg).toBe("string");
    expect(litSvg).toContain("<svg");
    expect(litSvg).toContain('viewBox="0 0 256 320"');
  });
});

describe("PoweredByLit", () => {
  it("renders the resized lit logo and label", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(html`${PoweredByLit() as TemplateResult}`, container);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute("width")).toBe("13");
    expect(svg!.getAttribute("height")).toBe("16");
    expect(container.textContent).toContain("Powered by Lit");
    expect(container.textContent).toContain("@yukino.js/lit-jsx");
  });
});

describe("icon helpers", () => {
  const lucide =
    '<svg class="lucide lucide-copy" stroke-width="2"><path d="M0 0"/></svg>';

  it("icon() swaps the lucide class and strips comments/newlines", () => {
    const out = icon(`<!-- c -->\n${lucide}`, "w-4 h-4");
    expect(out).toContain('class="lucide w-4 h-4"');
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("\n");
  });

  it("iconWith() also overrides stroke width", () => {
    const out = iconWith(lucide, { className: "w-5", strokeWidth: 1.5 });
    expect(out).toContain('class="lucide w-5"');
    expect(out).toContain('stroke-width="1.5"');
  });
});

describe("community barrel", () => {
  it("re-exports router, icon and powered-by surfaces", () => {
    expect(typeof community.createHashRouter).toBe("function");
    expect(typeof community.createBrowserRouter).toBe("function");
    expect(community.createHistoryRouter).toBe(community.createBrowserRouter);
    expect(typeof community.Link).toBe("function");
    expect(typeof community.icon).toBe("function");
    expect(typeof community.PoweredByLit).toBe("function");
    expect(community.router.mode).toMatch(/^(hash|history)$/);
  });
});
