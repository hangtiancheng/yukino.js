import { Text } from "./element";
import type { Props, VNode } from "./element";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const ATTRIBUTE_ALIAS: Record<string, string> = {
  className: "class",
  htmlFor: "for",
};

/** Props consumed by the reconciler itself — never written to the DOM */
const RESERVED_PROPS = new Set([
  "children",
  "key",
  "ref",
  "dangerouslySetInnerHTML",
]);

/** CSS properties that take unitless numbers (preact's proven pattern) */
const UNITLESS_STYLE_REGEXP =
  /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;

function isEventName(name: string): boolean {
  return (
    name.length > 2 &&
    name.startsWith("on") &&
    name[2] === name[2].toUpperCase()
  );
}

function eventTypeOf(name: string): string {
  return name.slice(2).toLowerCase();
}

export function createDom(vNode: VNode, parentDom: Node): Node {
  if (vNode.type === Text) {
    return document.createTextNode(vNode.props.nodeValue);
  }
  const type = vNode.type as string;
  // <svg> opens the namespace; descendants inherit it until <foreignObject> escapes back to HTML
  const dom =
    type === "svg" ||
    ((parentDom as Element).namespaceURI === SVG_NAMESPACE &&
      parentDom.nodeName !== "foreignObject")
      ? document.createElementNS(SVG_NAMESPACE, type)
      : document.createElement(type);
  updateProps(dom, {}, vNode.props);
  return dom;
}

/** Incrementally update props: remove stale ones first, then skip unchanged ones via Object.is */
export function updateProps(
  dom: Element,
  oldProps: Props,
  newProps: Props,
): void {
  for (const name of Object.keys(oldProps)) {
    if (RESERVED_PROPS.has(name) || name in newProps) {
      continue;
    }
    if (isEventName(name)) {
      dom.removeEventListener(eventTypeOf(name), oldProps[name]);
      continue;
    }
    dom.removeAttribute(ATTRIBUTE_ALIAS[name] ?? name);
  }

  for (const name of Object.keys(newProps)) {
    if (RESERVED_PROPS.has(name)) {
      continue;
    }
    const next = newProps[name];
    const prev = oldProps[name];
    if (Object.is(prev, next)) {
      continue;
    }
    if (isEventName(name)) {
      const eventType = eventTypeOf(name);
      if (prev) {
        dom.removeEventListener(eventType, prev);
      }
      if (next) {
        dom.addEventListener(eventType, next);
      }
      continue;
    }
    if (name === "style") {
      applyStyle(dom as HTMLElement, prev, next);
      continue;
    }
    setProp(dom, name, next);
  }

  // Like React, dangerouslySetInnerHTML is the explicit trusted-HTML escape
  // hatch: the value is parsed as markup, so callers must sanitize untrusted input.
  const nextHtml = newProps.dangerouslySetInnerHTML?.__html;
  const prevHtml = oldProps.dangerouslySetInnerHTML?.__html;
  if (nextHtml !== prevHtml) {
    dom.innerHTML = nextHtml ?? "";
  }
}

function setProp(dom: Element, name: string, value: unknown): void {
  const attribute = ATTRIBUTE_ALIAS[name];
  if (attribute !== undefined) {
    if (value === null || value === undefined) {
      dom.removeAttribute(attribute);
    } else {
      dom.setAttribute(attribute, String(value));
    }
    return;
  }
  // Controlled properties like value / checked only reflect in the UI when
  // written as properties. SVG elements are excluded: their reflected props
  // (className, width, ...) are read-only SVGAnimated* objects.
  if (dom.namespaceURI !== SVG_NAMESPACE && name in dom) {
    Reflect.set(dom, name, value === null || value === undefined ? "" : value);
    return;
  }
  if (value === null || value === undefined || value === false) {
    dom.removeAttribute(name);
    return;
  }
  dom.setAttribute(name, value === true ? "" : String(value));
}

type StyleValue = string | Record<string, string | number> | null | undefined;

function setStyleValue(
  style: CSSStyleDeclaration,
  name: string,
  value: string | number | null | undefined,
): void {
  if (name.startsWith("--")) {
    style.setProperty(
      name,
      value === null || value === undefined ? "" : String(value),
    );
    return;
  }
  const resolved =
    typeof value === "number" && !UNITLESS_STYLE_REGEXP.test(name)
      ? `${value}px`
      : (value ?? "");
  Reflect.set(style, name, resolved);
}

function applyStyle(
  dom: HTMLElement,
  prev: StyleValue,
  next: StyleValue,
): void {
  if (next === null || next === undefined) {
    dom.style.cssText = "";
    return;
  }
  if (typeof next === "string") {
    dom.style.cssText = next;
    return;
  }
  if (typeof prev === "string") {
    dom.style.cssText = "";
  }
  if (prev && typeof prev === "object") {
    for (const name of Object.keys(prev)) {
      if (!(name in next)) {
        setStyleValue(dom.style, name, "");
      }
    }
  }
  for (const name of Object.keys(next)) {
    if (
      typeof prev !== "object" ||
      prev === null ||
      prev[name] !== next[name]
    ) {
      setStyleValue(dom.style, name, next[name]);
    }
  }
}

/**
 * Attach `props.ref` to a freshly inserted host element. A function ref may
 * return a cleanup (React 19 semantics), stored on the instance; an object
 * ref gets `.current` assigned.
 */
export function attachRef(vnode: VNode): void {
  const ref = vnode.props.ref;
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    const cleanup = ref(vnode.dom);
    vnode.refCleanup = typeof cleanup === "function" ? cleanup : null;
    return;
  }
  ref.current = vnode.dom;
}

/**
 * Detach a ref (unmount, or the old ref when a patch swaps refs). Prefers the
 * stored cleanup; a cleanup-less function ref is called with null.
 *
 * @param ref The ref to detach — defaults to the instance's own; patch passes
 *            the OLD props' ref explicitly while `vnode` already carries the
 *            old cleanup via instantiate().
 */
export function detachRef(vnode: VNode, ref: unknown = vnode.props.ref): void {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    if (vnode.refCleanup !== null) {
      vnode.refCleanup();
      vnode.refCleanup = null;
    } else {
      ref(null);
    }
    return;
  }
  (ref as { current: unknown }).current = null;
}
