import { html, unsafeStatic } from "lit/static-html.js";
import { getNativeEventName } from "./event-utils";
import type { ElementRegistry } from "../types";

export function getHTMLTag(type: string, registry: ElementRegistry) {
  if (window.customElements.get(type)) {
    // If this is the tag of a registered custom element, allow it to be used.
    // This is deemed unsafe because we're injecting html tags using dynamic user-generated content,
    // which is typically an XSS vector; but considering we're only doing it for
    // registered custom elements, I think it's (probably) fine.
    // Note that only user-defined custom elements will fall here;
    // Twixt "primitives" like `twixt-button` get handled below, since the `type` is 'button'.
    return unsafeStatic(type);
  }
  // Fallback to the registry's default element.
  return registry[type] || registry.default;
}

// Parse JSX-friendly props into their corresponding Lit expression.
// https://lit.dev/docs/templates/expressions/
export function parseProps(
  type: string,
  props: Record<string, unknown>,
  registry: ElementRegistry,
) {
  const parsedProps: Record<string, unknown> = {};
  let eventName: string | undefined;

  for (const propName of Object.keys(props)) {
    const value = props[propName];
    // If the type is the element registry, we consider it a "primitive".
    // In DOM, these will be your `button`s, `div`s, etc.
    // in Canvas, these would be `twixt-button`, `twixt-div`, etc.
    if (registry[type]) {
      if (value == null) continue;
      // We don't want to automatically attach events to the top-level node of non-primitives (i.e user-defined custom elements).
      // Meaning, <MyCustomElement onClick={...} /> should _not_ automatically
      // get a click handler on its top node - it should be up to <MyCustomElement />'s implementation
      // to decide how (or if) it should handle a received prop that _happens_ to be named "onClick".
      eventName = getNativeEventName(propName);
      if (eventName) {
        parsedProps[`@${eventName}`] = value;
        continue;
      }
      if (propName === "class") {
        parsedProps[".className"] = value;
        continue;
      }
      if (propName.includes("-")) {
        parsedProps[propName] = value;
        continue;
      }
      if (typeof value === "boolean") {
        // Likewise, don't set attributes on non-primitives, just forward the props.
        parsedProps[`?${propName}`] = value;
      }
    }
    // Forward the prop to the element.
    parsedProps[`.${propName}`] = value;
  }

  return parsedProps;
}

// Handle any type-based overrides to the children's Lit expression, if any.
// Useful if, for example, a custom element registry needs to handle text in any special way.
export function parseChildren(
  children: unknown = [],
  registry: ElementRegistry,
) {
  const parsedChildren: unknown[] = [];
  const childList = Array.isArray(children) ? children : [children];
  for (const child of childList) {
    // React-style conditional rendering: `false`, `true`, `null` and
    // `undefined` children render nothing (lit-html would render booleans
    // as text, e.g. `{cond && <div/>}` producing the string "false").
    if (typeof child === "boolean" || child == null) continue;
    const wrapper = registry[typeof child];
    parsedChildren.push(
      wrapper ? (html`<${wrapper}>${child}</${wrapper}>` as never) : child,
    );
  }
  return parsedChildren;
}
