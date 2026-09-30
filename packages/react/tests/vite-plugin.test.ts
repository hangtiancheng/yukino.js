import { describe, expect, it } from "vitest";
import type { UserConfig } from "vite";
import { injectComponentHmrSnippet, reactPlugin } from "@yukino.js/react/vite";

function callConfig(userConfig: UserConfig): UserConfig | undefined {
  const plugin = reactPlugin();
  const config = plugin.config as (
    config: UserConfig,
    env: { command: string; mode: string },
  ) => UserConfig | undefined;
  return config(userConfig, { command: "serve", mode: "development" });
}

function callTransform(
  code: string,
  id: string,
  command: "serve" | "build" = "serve",
): unknown {
  const plugin = reactPlugin();
  const configResolved = plugin.configResolved as (config: {
    command: string;
  }) => void;
  configResolved({ command });
  const transform = plugin.transform as (
    code: string,
    id: string,
  ) => { code: string; map: null } | undefined;
  return transform(code, id);
}

describe("injectComponentHmrSnippet", () => {
  it("keeps named function declarations and appends the alias + snippet", () => {
    const source = `export default function App() {\n  return null;\n}\n`;
    const output = injectComponentHmrSnippet(source);
    expect(output).toContain("function App() {");
    expect(output).not.toContain("export default function");
    expect(output).toContain("const __react_component__ = App;");
    expect(output).toContain("export default __react_component__;");
    expect(output).toContain("import.meta.hot.accept");
    expect(output).toContain("globalThis.__react_hmr__?.hotSwapByComponent");
  });

  it("const-wraps identifier and arrow default exports", () => {
    const source = `const App = () => null;\nexport default App;\n`;
    const output = injectComponentHmrSnippet(source);
    expect(output).toContain("const __react_component__ = App;");
    expect(output).toContain("export default __react_component__;");
    expect(output).toContain("import.meta.hot.dispose");
  });

  it("is idempotent and leaves sources without a default export unchanged", () => {
    const source = `export default function App() { return null; }\n`;
    const once = injectComponentHmrSnippet(source);
    expect(injectComponentHmrSnippet(once)).toBe(once);

    const named = `export function util() {}\n`;
    expect(injectComponentHmrSnippet(named)).toBe(named);
  });

  it("ignores commented-out default exports", () => {
    const source = `// export default App\nexport const x = 1;\n`;
    expect(injectComponentHmrSnippet(source)).toBe(source);
  });
});

describe("reactPlugin.config", () => {
  it("defaults the esbuild JSX transform to the yukino automatic runtime", () => {
    expect(callConfig({})).toEqual({
      esbuild: { jsx: "automatic", jsxImportSource: "@yukino.js/react" },
    });
  });

  it("respects user-provided jsx settings", () => {
    expect(callConfig({ esbuild: { jsx: "preserve" } })).toBe(undefined);
    expect(callConfig({ esbuild: false })).toBe(undefined);
    expect(callConfig({ esbuild: { jsxImportSource: "custom" } })).toEqual({
      esbuild: { jsx: "automatic" },
    });
    expect(
      callConfig({
        esbuild: { jsx: "automatic", jsxImportSource: "custom" },
      }),
    ).toBe(undefined);
  });
});

describe("reactPlugin.transform", () => {
  const component = `export default function App() { return null; }\n`;

  it("injects into .tsx/.jsx modules during dev", () => {
    const result = callTransform(component, "/src/app.tsx") as {
      code: string;
      map: null;
    };
    expect(result.code).toContain("__react_component__");
    expect(result.map).toBe(null);
    expect(callTransform(component, "/src/app.jsx")).toBeDefined();
  });

  it("skips builds, node_modules, non-JSX ids and no-op sources", () => {
    expect(callTransform(component, "/src/app.tsx", "build")).toBe(undefined);
    expect(callTransform(component, "/node_modules/dep/app.tsx")).toBe(
      undefined,
    );
    expect(callTransform(component, "/src/app.ts")).toBe(undefined);
    expect(callTransform("export const x = 1;\n", "/src/app.tsx")).toBe(
      undefined,
    );
  });

  it("strips query suffixes before matching the extension", () => {
    expect(callTransform(component, "/src/app.tsx?v=123")).toBeDefined();
    expect(callTransform(component, "/src/app.ts?import")).toBe(undefined);
  });
});
