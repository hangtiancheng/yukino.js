import type { RefOrCallback } from "lit/directives/ref.js";
import type { StyleInfo } from "lit/directives/style-map.js";
import customElementRegistry from "./utils/custom-element-registry";
import createElement from "./core/create-element";

type EventProps = {
  [EventName in keyof HTMLElementEventMap as `on${Capitalize<EventName>}`]?: (
    event: HTMLElementEventMap[EventName],
  ) => void;
};

type ElementProps<T extends Element> = Omit<Partial<T>, "children" | "style"> &
  EventProps & {
    children?: unknown;
    ref?: RefOrCallback<T>;
    style?: Readonly<StyleInfo>;
    [property: string]: unknown;
  };

// eslint-disable-next-line @typescript-eslint/no-namespace -- TypeScript requires this namespace for automatic JSX runtime types.
export namespace JSX {
  export type Element = unknown;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  export interface IntrinsicAttributes {
    key?: string | number;
    ref?: RefOrCallback;
    [property: string]: unknown;
  }

  export type IntrinsicElements = {
    [TagName in keyof HTMLElementTagNameMap]: ElementProps<
      HTMLElementTagNameMap[TagName]
    >;
  } & {
    [tagName: string]: ElementProps<HTMLElement>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function jsx(type: string | Function, config: Record<string, unknown>) {
  if (typeof type === "function") {
    if (type.prototype instanceof HTMLElement) {
      let tagName = customElementRegistry.get(type);
      if (!tagName) {
        const CustomElement = type as new () => HTMLElement;
        const element = new CustomElement();
        tagName = element.localName;
        customElementRegistry.set(type, tagName);
      }
      return createElement(tagName, config);
    }
    return type(config);
  }
  return createElement(type, config);
}

function jsxFragment(fragment: { children?: unknown }) {
  return Array.isArray(fragment.children)
    ? fragment.children
    : [fragment.children];
}

export { jsx, jsx as jsxs, jsx as jsxDEV, jsxFragment as Fragment };
