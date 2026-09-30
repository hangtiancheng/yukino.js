import { describe, it, expect } from "vitest";
import { aliasComponent, canonicalComponent } from "../src/component-registry";
import type { Component } from "../src/jsx/vnode";

const makeComponent = (): Component => () => null;

describe("component-registry (HMR alias map)", () => {
  it("canonicalComponent resolves non-aliased components to themselves", () => {
    const A = makeComponent();
    expect(canonicalComponent(A)).toBe(A);
  });

  it("canonicalComponent resolves stale references through alias chains", () => {
    const v1 = makeComponent();
    const v2 = makeComponent();
    const v3 = makeComponent();
    aliasComponent(v1, v2);
    aliasComponent(v2, v3);
    expect(canonicalComponent(v1)).toBe(v3); // chain: v1 → v2 → v3
    expect(canonicalComponent(v2)).toBe(v3);
    expect(canonicalComponent(v3)).toBe(v3);
  });

  it("self-aliasing is a no-op", () => {
    const A = makeComponent();
    aliasComponent(A, A);
    expect(canonicalComponent(A)).toBe(A);
  });

  it("alias cycles terminate", () => {
    const a = makeComponent();
    const b = makeComponent();
    aliasComponent(a, b);
    aliasComponent(b, a);
    // Cycle a → b → a: resolution terminates and returns one of the pair.
    const resolved = canonicalComponent(a);
    expect(resolved === a || resolved === b).toBe(true);
  });
});
