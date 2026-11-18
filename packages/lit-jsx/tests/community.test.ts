import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { html, render } from "lit";
import litSvg from "@/assets/lit.svg?raw";
import { icon, iconWith } from "@/community/icon";
import * as community from "@/community";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  render(html``, container);
  container.remove();
});

describe("?raw imports", () => {
  it("imports file contents as a string", () => {
    expect(typeof litSvg).toBe("string");
    expect(litSvg).toContain("<svg");
    expect(litSvg).toContain('viewBox="0 0 256 320"');
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

  it("replaces non-lucide root classes without duplicate attributes", () => {
    const out = icon(
      "<svg class='other'><path class='lucide-child'/></svg>",
      "w-4",
    );
    const document = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.documentElement.getAttribute("class")).toBe("lucide w-4");
    expect(document.querySelector("path")!.getAttribute("class")).toBe(
      "lucide-child",
    );
  });

  it("adds root stroke-width without modifying a child's stroke-width", () => {
    const out = iconWith('<svg><path stroke-width="1"/></svg>', {
      strokeWidth: 3,
    });
    const document = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(document.documentElement.getAttribute("stroke-width")).toBe("3");
    expect(document.querySelector("path")!.getAttribute("stroke-width")).toBe(
      "1",
    );
  });

  it("does not mistake text inside a quoted attribute for an attribute", () => {
    const out = icon(
      `<svg aria-label="the class='example' icon" class="old"/>`,
      "new",
    );
    const document = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(document.documentElement.getAttribute("class")).toBe("lucide new");
    expect(document.documentElement.getAttribute("aria-label")).toBe(
      "the class='example' icon",
    );
  });

  it("strips comments containing > and escapes class attribute values", () => {
    const className = 'size-4" data-extra="a&b';
    const out = icon("<!-- a > b -->\n<svg/>", className);
    expect(out).not.toContain("<!--");
    const document = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.documentElement.getAttribute("class")).toBe(
      `lucide ${className}`,
    );
    expect(document.documentElement.hasAttribute("data-extra")).toBe(false);
  });
});

describe("community barrel", () => {
  it("re-exports router and icon surfaces", () => {
    expect(typeof community.createHashRouter).toBe("function");
    expect(typeof community.createBrowserRouter).toBe("function");
    expect(community.createHistoryRouter).toBe(community.createBrowserRouter);
    expect(typeof community.Link).toBe("function");
    expect(typeof community.icon).toBe("function");
    expect(community.router.mode).toMatch(/^(hash|history)$/);
  });
});
