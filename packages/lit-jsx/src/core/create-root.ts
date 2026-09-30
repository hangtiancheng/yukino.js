import { nothing, render as renderLit } from "lit";
import type { RootElement } from "../types";

export class Root {
  _container?: RootElement;

  static _roots = new Map<RootElement, Root>();

  constructor(container: RootElement) {
    this._container = container;
    Root._roots.set(container, this);
  }

  render(element: unknown) {
    if (!this._container) {
      throw new Error("Cannot render an unmounted root.");
    }
    renderLit(element, this._container);
    return element;
  }

  unmount() {
    if (this._container) {
      renderLit(nothing, this._container);
      Root._roots.delete(this._container);
    }
    this._container = undefined;
  }
}

export function createRoot(container: RootElement) {
  const existingRoot = Root._roots.get(container);
  if (existingRoot) {
    console.warn(`Warning: You are calling createRoot() on a container that has already been passed to createRoot() before.
Call root.render() on the existing root instead if you want to update it.`);
    return existingRoot;
  }
  return new Root(container);
}
