import { describe, expect, it } from "vitest";
import {
  injectComponentHmrSnippet,
  isComponentSource,
} from "../src/hmr-inject";

const component = `export default function App() {\n  return null;\n}\n`;

describe("isComponentSource", () => {
  it("detects line-leading default exports only", () => {
    expect(isComponentSource(component)).toBe(true);
    expect(
      isComponentSource(`const App = () => null;\nexport default App;\n`),
    ).toBe(true);
    expect(isComponentSource(`export function util() {}\n`)).toBe(false);
    expect(isComponentSource(`// export default App\n`)).toBe(false);
  });
});

describe("injectComponentHmrSnippet (vite flavor)", () => {
  it("emits the import.meta.hot accept-callback snippet", () => {
    const output = injectComponentHmrSnippet(component, "vite");
    expect(output).toContain("const __react_component__ = App;");
    expect(output).toContain("export default __react_component__;");
    expect(output).toContain("import.meta.hot.dispose");
    expect(output).toContain("import.meta.hot.accept");
    expect(output).toContain("globalThis.__react_hmr__?.hotSwapByComponent");
    expect(output).not.toContain("import.meta.webpackHot");
  });

  it("guards non-function default exports with typeof checks", () => {
    const config = `export default { title: "site" };\n`;
    const output = injectComponentHmrSnippet(config, "vite");
    expect(output).toContain('typeof oldComponent === "function"');
    expect(output).toContain('typeof newComponent === "function"');
  });
});

describe("injectComponentHmrSnippet (webpack flavor)", () => {
  it("emits the self-accept snippet with a top-level data check", () => {
    const output = injectComponentHmrSnippet(component, "webpack");
    expect(output).toContain("import.meta.webpackHot");
    expect(output).toContain("import.meta.webpackHot.data?.oldComponent");
    expect(output).toContain("import.meta.webpackHot.dispose");
    expect(output).toContain("globalThis.__react_hmr__?.hotSwapByComponent");
    expect(output).not.toContain("import.meta.hot.accept");
    expect(output).toContain("import.meta.webpackHot.accept((err)");
    expect(output).toContain("globalThis.location?.reload()");
  });

  it("keeps named-declaration bindings and appends alias + export", () => {
    const output = injectComponentHmrSnippet(component, "webpack");
    expect(output).toContain("function App() {");
    expect(output).not.toContain("export default function");
    expect(output).toContain("const __react_component__ = App;");
    expect(output).toContain("export default __react_component__;");
  });
});

describe("injectComponentHmrSnippet (shared rewrite)", () => {
  it("preserves `as` casts in expression default exports", () => {
    const source = `const cfg = {};\nexport default cfg as Record<string, unknown>;\n`;
    const output = injectComponentHmrSnippet(source, "webpack");
    expect(output).toContain(
      "const __react_component__ = cfg as Record<string, unknown>;",
    );
  });

  it("survives JSX text containing apostrophes", () => {
    const source = `export default function App() {\n  return <p>it's fine</p>;\n}\n`;
    const output = injectComponentHmrSnippet(source, "vite");
    expect(output).toContain("it's fine");
    expect(output).toContain("const __react_component__ = App;");
  });

  it("is idempotent and skips sources without a default export", () => {
    const once = injectComponentHmrSnippet(component, "webpack");
    expect(injectComponentHmrSnippet(once, "webpack")).toBe(once);

    const named = `export function util() {}\n`;
    expect(injectComponentHmrSnippet(named, "webpack")).toBe(named);

    const commented = `// export default App\nexport const x = 1;\n`;
    expect(injectComponentHmrSnippet(commented, "webpack")).toBe(commented);
  });
});
