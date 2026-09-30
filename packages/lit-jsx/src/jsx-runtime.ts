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

// JSX runtime. This is what will translate JSX and create actual html elements.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function jsx(type: string | Function, config: Record<string, unknown>) {
  // If the type is a function, we're dealing with a nested user-defined component template (i.e <YourComponent />).
  // This can either be a custom element extending HTMLElement or a simple functional component.
  if (typeof type === "function") {
    if (type.prototype instanceof HTMLElement) {
      // Class component.
      // Hack: we don't want to construct the custom element here, we want to just call createElement('your-custom-element')
      // and let Lit handle it as it would any other element. For that, we need to be able
      // to get the tag name of the custom element from its constructor, which unfortunately is not currently possible.
      // So for now, we keep an internal registry of all web components we've registered, falling back to
      // constructing the element once to get its `.localName`.
      // See {@link src/decorators/customElement} for more info.
      let tagName = customElementRegistry.get(type);
      if (!tagName) {
        // We have to construct the element to get its tag name.
        const CustomElement = type as new () => HTMLElement;
        const element = new CustomElement();
        tagName = element.localName;
        // Cache the tag name so that we don't have to do this again.
        customElementRegistry.set(type, tagName);
      }
      // Render the custom web component as any other html element.
      return createElement(tagName, config);
    }
    // Functional component.
    // We call the function with the props and because its return value is JSX
    // we'll eventually get here again but to handle the underlying primitive types (<div>, <button>),
    // for which we'll hit createElement below.
    return type(config);
  }
  // Simple JSX tags (<div>, <button>, etc).
  return createElement(type, config);
}

function jsxFragment(fragment: { children?: unknown }) {
  // When the fragment only has one child, children is the child object.
  return Array.isArray(fragment.children)
    ? fragment.children
    : [fragment.children];
}

export { jsx, jsx as jsxs, jsx as jsxDEV, jsxFragment as Fragment };
