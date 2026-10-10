import { batch, untracked, signal, effect, Signal } from "../reactive";
import { devWarn } from "../utils";
import { SVG_NS, MATH_NS, strSafe } from "../common";
import { canonicalComponent } from "../component-registry";
import {
  createInstance,
  writeInstanceProps,
  beginRender,
  endRender,
  flushInstanceEffects,
  destroyInstanceState,
  registerInstance,
  type Instance,
} from "../component";
import {
  Fragment,
  isRawHTML,
  isVNode,
  type Component,
  type JSXNode,
} from "./vnode";
import type { AnyFunc, RefValue } from "../types";

const TEXT = 1;
const ELEMENT = 2;
const RAW = 3;
const COMPONENT = 4;

interface NText {
  k: typeof TEXT;
  text: string;
}
interface NElement {
  k: typeof ELEMENT;
  type: string;
  key: string | undefined;
  props: Record<string, unknown>;
}
interface NRaw {
  k: typeof RAW;
  html: string;
}
interface NComponent {
  k: typeof COMPONENT;
  fn: Component;
  key: string | undefined;
  props: Record<string, unknown>;
}
type NItem = NText | NElement | NRaw | NComponent;

interface EventBinding {
  proxy: EventListener;
  current: AnyFunc | undefined;
}

interface RText {
  k: typeof TEXT;
  text: string;
  dom: Text;
}
interface RElement {
  k: typeof ELEMENT;
  type: string;
  key: string | undefined;
  attrs: Record<string, unknown>;
  dom: Element;
  children: RNode[];
  events?: Record<string, EventBinding>;
  ref?: RefValue;
}
interface RRaw {
  k: typeof RAW;
  html: string;
  doms: ChildNode[];
}
interface RComponent {
  k: typeof COMPONENT;
  key: string | undefined;
  instance: Instance;
  nodes: RNode[];
  end: Comment;
  host: Element;
  ns: string | null;
}
type RNode = RText | RElement | RRaw | RComponent;

type PendingOp =
  | { t: 1; r: RComponent }
  | { t: 2; inst: Instance; props: Record<string, unknown> }
  | {
      t: 3;
      prev: RefValue | undefined;
      ref: RefValue | undefined;
      el: Element | null;
    };

interface Pass {
  ops: PendingOp[];
}

interface RootRecord {
  vnode: Signal<JSXNode>;
  dispose: () => void;
  nodes: RNode[];
  end: Comment;
}

const roots = new WeakMap<Element, RootRecord>();

export function render(node: JSXNode, container: Element): void {
  const existing = roots.get(container);
  if (existing) {
    existing.vnode.value = node;
    return;
  }
  container.textContent = "";
  const end = document.createComment("");
  container.appendChild(end);
  const rec: RootRecord = {
    vnode: signal(node),
    dispose: () => undefined,
    nodes: [],
    end,
  };
  rec.dispose = effect(() => {
    renderRoot(container, rec, rec.vnode.value);
  });
  roots.set(container, rec);
}

function renderRoot(
  container: Element,
  rec: RootRecord,
  content: JSXNode,
): void {
  const pass: Pass = { ops: [] };
  const items: NItem[] = [];
  normalizeInto(content, items);
  const ns =
    container.namespaceURI === SVG_NS
      ? SVG_NS
      : container.namespaceURI === MATH_NS
        ? MATH_NS
        : null;
  rec.nodes = patchChildren(container, rec.nodes, items, pass, ns, rec.end);
  untracked(() => flushOps(pass.ops));
}

export function unmount(container: Element): boolean {
  const rec = roots.get(container);
  if (!rec) return false;
  roots.delete(container);
  rec.dispose();
  for (const r of rec.nodes) destroyRNode(r);
  container.textContent = "";
  return true;
}

function normalizeInto(node: JSXNode, out: NItem[]): void {
  if (node == null || typeof node === "boolean" || node === "") return;
  if (typeof node === "string" || typeof node === "number") {
    out.push({ k: TEXT, text: String(node) });
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) normalizeInto(child, out);
    return;
  }
  if (node instanceof Signal) {
    normalizeInto(node.value as JSXNode, out);
    return;
  }
  if (isRawHTML(node)) {
    if (node.html) out.push({ k: RAW, html: node.html });
    return;
  }
  if (isVNode(node)) {
    const { type, props } = node;
    if (type === Fragment) {
      normalizeInto(props["children"] as JSXNode, out);
      return;
    }
    if (typeof type === "function") {
      out.push({
        k: COMPONENT,
        fn: canonicalComponent(type as Component),
        key: node.key,
        props,
      });
      return;
    }
    if (typeof type === "string") {
      out.push({ k: ELEMENT, type, key: node.key, props });
      return;
    }
    devWarn("Skipped VNode with an unsupported symbol tag.");
    return;
  }
  devWarn(`Skipped non-renderable child of type "${typeof node}".`);
}

function compatible(r: RNode, item: NItem): boolean {
  if (r.k !== item.k) return false;
  if (r.k === ELEMENT) return r.type === (item as NElement).type;
  if (r.k === COMPONENT) {
    return r.instance.fn === (item as NComponent).fn;
  }
  return true;
}

function rnodeDoms(r: RNode): ChildNode[] {
  if (r.k === RAW) return r.doms;
  if (r.k === COMPONENT) {
    const out: ChildNode[] = [];
    collectComponentDoms(r, out);
    return out;
  }
  return [r.dom];
}

function collectComponentDoms(r: RComponent, out: ChildNode[]): void {
  for (const child of r.nodes) {
    if (child.k === RAW) {
      for (const dom of child.doms) out.push(dom);
    } else if (child.k === COMPONENT) {
      collectComponentDoms(child, out);
    } else {
      out.push(child.dom);
    }
  }
  out.push(r.end);
}

function patchChildren(
  parentDom: Element,
  oldList: RNode[],
  items: NItem[],
  pass: Pass,
  ns: string | null,
  endAnchor: ChildNode | null,
): RNode[] {
  let keyed: Map<string, RNode> | undefined;
  const rest: (RNode | undefined)[] = [];
  for (const r of oldList) {
    const key = r.k === ELEMENT || r.k === COMPONENT ? r.key : undefined;
    if (key !== undefined) {
      if (!keyed) keyed = new Map();
      if (!keyed.has(key)) {
        keyed.set(key, r);
        continue;
      }
    }
    rest.push(r);
  }

  let restCursor = 0;
  const matchRest = (item: NItem): RNode | undefined => {
    for (let i = restCursor; i < rest.length; i++) {
      const r = rest[i];
      if (r && compatible(r, item)) {
        rest[i] = undefined;
        if (i === restCursor) restCursor++;
        return r;
      }
    }
    return undefined;
  };

  const result: RNode[] = new Array(items.length) as RNode[];
  let seenKeys: Set<string> | undefined;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let matched: RNode | undefined;
    const key =
      item.k === ELEMENT || item.k === COMPONENT ? item.key : undefined;
    if (key !== undefined) {
      if (!seenKeys) seenKeys = new Set();
      if (seenKeys.has(key)) {
        devWarn(
          `Duplicate key "${key}" among siblings — keys must be unique within a list.`,
        );
      }
      seenKeys.add(key);
      const candidate = keyed?.get(key);
      if (candidate && compatible(candidate, item)) {
        keyed?.delete(key);
        matched = candidate;
      }
    } else {
      matched = matchRest(item);
    }
    result[i] = matched
      ? patchNode(matched, item, pass, ns)
      : createNode(item, pass, parentDom, ns);
  }

  if (keyed) {
    for (const r of keyed.values()) removeRNode(r);
  }
  for (const r of rest) {
    if (r) removeRNode(r);
  }

  let ref: ChildNode | null = endAnchor;
  for (let i = result.length - 1; i >= 0; i--) {
    const doms = rnodeDoms(result[i]);
    for (let j = doms.length - 1; j >= 0; j--) {
      const dom = doms[j];
      if (dom.parentNode !== parentDom || dom.nextSibling !== ref) {
        parentDom.insertBefore(dom, ref);
      }
      ref = dom;
    }
  }
  return result;
}

function removeRNode(r: RNode): void {
  destroyRNode(r);
  for (const dom of rnodeDoms(r)) {
    dom.parentNode?.removeChild(dom);
  }
}

function destroyRNode(r: RNode): void {
  switch (r.k) {
    case TEXT:
      return;
    case ELEMENT:
      for (const child of r.children) destroyRNode(child);
      if (r.ref) callRef(r.ref, null);
      return;
    case RAW:
      return;
    case COMPONENT: {
      const inst = r.instance;
      if (inst.renderDispose) {
        const dispose = inst.renderDispose;
        inst.renderDispose = undefined;
        dispose();
      }
      for (const child of r.nodes) destroyRNode(child);
      destroyInstanceState(inst);
      return;
    }
  }
}

function createNode(
  item: NItem,
  pass: Pass,
  parentDom: Element,
  ns: string | null,
): RNode {
  switch (item.k) {
    case TEXT:
      return {
        k: TEXT,
        text: item.text,
        dom: document.createTextNode(item.text),
      };
    case RAW:
      return createRaw(item);
    case ELEMENT:
      return createElement(item, pass, ns);
    case COMPONENT:
      return createComponent(item, pass, parentDom, ns);
  }
}

function patchNode(
  r: RNode,
  item: NItem,
  pass: Pass,
  ns: string | null,
): RNode {
  switch (r.k) {
    case TEXT: {
      const text = (item as NText).text;
      if (r.text !== text) {
        r.text = text;
        r.dom.nodeValue = text;
      }
      return r;
    }
    case RAW: {
      const html = (item as NRaw).html;
      if (r.html === html) return r;
      removeRNode(r);
      return createRaw(item as NRaw);
    }
    case ELEMENT: {
      const it = item as NElement;
      patchElementProps(r, it.props, pass);
      const childNs = childNamespace(r.type, elementNamespace(r.type, ns));
      const kids: NItem[] = [];
      normalizeInto(it.props["children"] as JSXNode, kids);
      r.children = patchChildren(r.dom, r.children, kids, pass, childNs, null);
      r.key = it.key;
      return r;
    }
    case COMPONENT: {
      const it = item as NComponent;
      r.key = it.key;
      pass.ops.push({ t: 2, inst: r.instance, props: it.props });
      return r;
    }
  }
}

function createRaw(item: NRaw): RRaw {
  const tpl = document.createElement("template");
  tpl.innerHTML = item.html;
  return { k: RAW, html: item.html, doms: Array.from(tpl.content.childNodes) };
}

function createComponent(
  item: NComponent,
  pass: Pass,
  parentDom: Element,
  ns: string | null,
): RComponent {
  const inst = createInstance(item.fn);
  writeInstanceProps(inst, item.props);
  const r: RComponent = {
    k: COMPONENT,
    key: item.key,
    instance: inst,
    nodes: [],
    end: document.createComment(""),
    host: parentDom,
    ns,
  };
  pass.ops.push({ t: 1, r });
  return r;
}

function mountComponent(r: RComponent): void {
  const inst = r.instance;
  registerInstance(inst);
  inst.renderDispose = effect(() => {
    inst.invalidate.value;
    if (inst.destroyed) return;
    renderComponent(r);
  });
}

function renderComponent(r: RComponent): void {
  const inst = r.instance;
  const pass: Pass = { ops: [] };
  const prev = beginRender(inst);
  let out: unknown;
  try {
    out = inst.fn(inst.proxy);
  } finally {
    endRender(inst, prev);
  }
  const items: NItem[] = [];
  normalizeInto(out as JSXNode, items);
  r.nodes = patchChildren(r.host, r.nodes, items, pass, r.ns, r.end);
  untracked(() => {
    flushOps(pass.ops);
    flushInstanceEffects(inst);
  });
}

function elementNamespace(
  type: string,
  parentNs: string | null,
): string | null {
  if (type === "svg") return SVG_NS;
  if (type === "math") return MATH_NS;
  return parentNs;
}

function childNamespace(type: string, ownNs: string | null): string | null {
  if (ownNs === SVG_NS && type === "foreignObject") return null;
  return ownNs;
}

function createElement(
  item: NElement,
  pass: Pass,
  parentNs: string | null,
): RElement {
  const ownNs = elementNamespace(item.type, parentNs);
  const el = ownNs
    ? document.createElementNS(ownNs, item.type)
    : document.createElement(item.type);
  const r: RElement = {
    k: ELEMENT,
    type: item.type,
    key: item.key,
    attrs: {},
    dom: el,
    children: [],
  };
  patchElementProps(r, item.props, pass);
  const kids: NItem[] = [];
  normalizeInto(item.props["children"] as JSXNode, kids);
  r.children = patchChildren(
    el,
    r.children,
    kids,
    pass,
    childNamespace(item.type, ownNs),
    null,
  );
  return r;
}

const ATTR_NAME_REGEXP = /^[^\s"'>/=\\]+$/;

const EVENT_PROP_REGEXP = /^on[A-Z]/;

const NATIVE_EVENT_PROP_REGEXP = /^on[a-z]/;

const STYLE_KEY_REGEXP = /[A-Z]/g;

const SKIP_PROPS = new Set([
  "children",
  "key",
  "class",
  "className",
  "style",
  "ref",
]);

const FORM_VALUE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

const ENUMERATED_BOOL_ATTRS = new Set([
  "contenteditable",
  "draggable",
  "spellcheck",
]);

function serializesBooleans(name: string): boolean {
  return ENUMERATED_BOOL_ATTRS.has(name) || name.startsWith("aria-");
}

function unwrap(value: unknown): unknown {
  return value instanceof Signal ? value.value : value;
}

function classToString(value: unknown): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => classToString(item))
      .filter((s) => s !== "")
      .join(" ");
  }
  if (typeof value === "object") {
    const names: string[] = [];
    for (const name of Object.keys(value)) {
      if ((value as Record<string, unknown>)[name]) names.push(name);
    }
    return names.join(" ");
  }
  return strSafe(value);
}

function styleToString(value: unknown): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const decls: string[] = [];
    for (const key of Object.keys(value)) {
      const v = (value as Record<string, unknown>)[key];
      if (v == null || v === "") continue;
      const cssKey = key.startsWith("--")
        ? key
        : key.replace(STYLE_KEY_REGEXP, (m) => "-" + m.toLowerCase());
      decls.push(`${cssKey}:${strSafe(v)}`);
    }
    return decls.join(";");
  }
  return strSafe(value);
}

function mergedClass(props: Record<string, unknown>): string {
  const a = classToString(unwrap(props["class"]));
  const b = classToString(unwrap(props["className"]));
  return a && b ? `${a} ${b}` : a || b;
}

function isFormStateProp(el: Element, name: string): boolean {
  if (name === "value") return FORM_VALUE_TAGS.has(el.nodeName);
  if (name === "checked") return el.nodeName === "INPUT";
  if (name === "selected") return el.nodeName === "OPTION";
  return false;
}

function patchElementProps(
  r: RElement,
  newProps: Record<string, unknown>,
  pass: Pass,
): void {
  const el = r.dom;
  const prev = r.attrs;
  const next: Record<string, unknown> = {};

  const cls = mergedClass(newProps);
  if (cls) next["class"] = cls;

  const style = styleToString(unwrap(newProps["style"]));
  if (style) next["style"] = style;

  const newRef = newProps["ref"] as RefValue | undefined;
  if (r.ref !== newRef) {
    pass.ops.push({ t: 3, prev: r.ref, ref: newRef, el });
    r.ref = newRef;
  }

  let seenTypes: Set<string> | undefined;
  for (const name of Object.keys(newProps)) {
    if (SKIP_PROPS.has(name)) continue;

    if (EVENT_PROP_REGEXP.test(name)) {
      const type = applyEvent(r, name, newProps[name]);
      if (type) {
        if (!seenTypes) seenTypes = new Set();
        seenTypes.add(type);
      }
      continue;
    }

    const value = unwrap(newProps[name]);

    if (
      NATIVE_EVENT_PROP_REGEXP.test(name) &&
      (typeof value === "string" || typeof value === "function")
    ) {
      devWarn(
        `Skipped "${name}" on <${r.type}> — use camelCase (e.g. "onClick") for Yukino events; ` +
          `native inline handlers are not allowed.`,
      );
      continue;
    }

    if (value == null || (value === false && !serializesBooleans(name)))
      continue;
    next[name] = value;
  }

  if (r.events) {
    for (const type of Object.keys(r.events)) {
      if (!seenTypes?.has(type)) r.events[type].current = undefined;
    }
  }

  for (const name of Object.keys(prev)) {
    if (!(name in next)) applyAttr(r, name, undefined);
  }
  for (const name of Object.keys(next)) {
    const value = next[name];
    if (value !== prev[name] || isFormStateProp(el, name))
      applyAttr(r, name, value);
  }

  r.attrs = next;
}

function applyEvent(
  r: RElement,
  name: string,
  value: unknown,
): string | undefined {
  if (value != null && typeof value !== "function") {
    devWarn(
      `Skipped event "${name}" on <${r.type}> — events accept inline functions only ` +
        `(onClick={() => ...}), got ${typeof value}.`,
    );
    return undefined;
  }
  if (
    name.endsWith("Capture") &&
    name !== "onGotPointerCapture" &&
    name !== "onLostPointerCapture"
  ) {
    devWarn(
      `Skipped "${name}" on <${r.type}> — capture-phase listeners are not supported; use a ref with addEventListener(type, fn, true) instead.`,
    );
    return undefined;
  }
  const type = name.slice(2).toLowerCase();
  let events = r.events;
  if (!events) events = r.events = {};
  let binding = events[type];
  if (!binding) {
    if (!value) return type;
    const b: EventBinding = {
      current: undefined,
      proxy: (e: Event) => {
        const fn = b.current;
        if (!fn) return;
        batch(() => fn(e));
      },
    };
    binding = events[type] = b;
    r.dom.addEventListener(type, b.proxy);
  }
  binding.current = value as AnyFunc | undefined;
  return type;
}

function applyAttr(r: RElement, name: string, value: unknown): void {
  const el = r.dom;

  if (!ATTR_NAME_REGEXP.test(name)) {
    devWarn(`Skipped invalid attribute name "${name}" on <${r.type}>.`);
    return;
  }

  if (isFormStateProp(el, name)) {
    if (name === "value") {
      const s = strSafe(value);
      if ((el as HTMLInputElement).value !== s) {
        (el as HTMLInputElement).value = s;
      }
    } else {
      const on = value != null && value !== false;
      if (Reflect.get(el, name) !== on) {
        Reflect.set(el, name, on);
      }
    }
    return;
  }

  if (value === undefined) {
    el.removeAttribute(name);
    return;
  }
  if (typeof value === "boolean" && serializesBooleans(name)) {
    el.setAttribute(name, value ? "true" : "false");
    return;
  }
  if (value === true) {
    el.setAttribute(name, "");
    return;
  }
  if (typeof value === "object" || typeof value === "function") {
    devWarn(
      `Skipped non-primitive attribute "${name}" on <${r.type}> — ` +
        `objects/functions are not serializable to attributes.`,
    );
    el.removeAttribute(name);
    return;
  }
  el.setAttribute(name, strSafe(value));
}

function callRef(ref: RefValue, el: Element | null): void {
  if (typeof ref === "function") {
    ref(el);
  } else if (ref && typeof ref === "object") {
    ref.current = el;
  }
}

function flushOps(ops: PendingOp[]): void {
  for (const op of ops) {
    switch (op.t) {
      case 1:
        mountComponent(op.r);
        break;
      case 2:
        writeInstanceProps(op.inst, op.props);
        break;
      case 3:
        if (op.prev) callRef(op.prev, null);
        if (op.ref) callRef(op.ref, op.el);
        break;
    }
  }
}
