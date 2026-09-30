import { describe, expect, it } from "vitest";
import { ReactPlugin, reactLoader } from "@yukino.js/react/webpack";

interface Rule {
  test: RegExp;
  exclude: RegExp;
  enforce: string;
  use: Array<{ loader: string }>;
}

function makeCompiler(mode?: string): {
  options: { mode?: unknown; module: { rules: unknown[] } };
} {
  return { options: { mode, module: { rules: [] } } };
}

const component = `export default function App() { return null; }\n`;

describe("ReactPlugin", () => {
  it("pushes a single enforce-pre loader rule", () => {
    const compiler = makeCompiler("development");
    new ReactPlugin().apply(compiler);

    expect(compiler.options.module.rules).toHaveLength(1);
    const rule = compiler.options.module.rules[0] as Rule;
    expect(rule.enforce).toBe("pre");
    expect(rule.test.test("app.tsx")).toBe(true);
    expect(rule.test.test("app.jsx")).toBe(true);
    expect(rule.test.test("app.ts")).toBe(false);
    expect(rule.exclude.test("/node_modules/dep/app.tsx")).toBe(true);
    expect(rule.use).toHaveLength(1);
    expect(rule.use[0].loader).toMatch(/webpack\.(ts|js|cjs)$/);
  });

  it("skips production builds", () => {
    const compiler = makeCompiler("production");
    new ReactPlugin().apply(compiler);
    expect(compiler.options.module.rules).toHaveLength(0);
  });

  it("respects custom test/exclude options", () => {
    const compiler = makeCompiler("development");
    new ReactPlugin({ test: /\.custom$/, exclude: /vendor/ }).apply(compiler);
    const rule = compiler.options.module.rules[0] as Rule;
    expect(rule.test.test("app.custom")).toBe(true);
    expect(rule.test.test("app.tsx")).toBe(false);
    expect(rule.exclude.test("/vendor/x.custom")).toBe(true);
  });
});

describe("reactLoader", () => {
  it("injects the webpack HMR snippet into default-export sources", () => {
    const output = reactLoader.call({}, component);
    expect(output).toContain("__react_component__");
    expect(output).toContain("import.meta.webpackHot");
  });

  it("passes through sources without a default export", () => {
    const source = `export const x = 1;\n`;
    expect(reactLoader.call({}, source)).toBe(source);
  });

  it("is a no-op in production mode", () => {
    expect(reactLoader.call({ mode: "production" }, component)).toBe(component);
  });
});
