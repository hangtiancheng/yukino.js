import { html, unsafeStatic } from "lit/static-html.js";
import { getNativeEventName } from "./event-utils";
import type { ElementRegistry } from "../types";

export function getHTMLTag(type: string, registry: ElementRegistry) {
  if (window.customElements.get(type)) {
    return unsafeStatic(type);
  }
  return registry[type] || registry.default;
}

export function parseProps(
  type: string,
  props: Record<string, unknown>,
  registry: ElementRegistry,
) {
  const parsedProps: Record<string, unknown> = {};
  let eventName: string | undefined;

  for (const propName of Object.keys(props)) {
    const value = props[propName];
    if (registry[type]) {
      if (value == null) continue;
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
        parsedProps[`?${propName}`] = value;
      }
    }
    parsedProps[`.${propName}`] = value;
  }

  return parsedProps;
}

export function parseChildren(
  children: unknown = [],
  registry: ElementRegistry,
) {
  const parsedChildren: unknown[] = [];
  const childList = Array.isArray(children) ? children : [children];
  for (const child of childList) {
    if (typeof child === "boolean" || child == null) continue;
    const wrapper = registry[typeof child];
    parsedChildren.push(
      wrapper ? (html`<${wrapper}>${child}</${wrapper}>` as never) : child,
    );
  }
  return parsedChildren;
}
