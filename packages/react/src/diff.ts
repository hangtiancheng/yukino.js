import { attachRef, createDom, detachRef, updateProps } from "./dom";
import { Text, toChildArray } from "./element";
import type { VNode, VNodeType } from "./element";
import { canonical, hmrActive } from "./hmr";
import {
  flushEffects,
  renderComponent,
  runEffectCleanups,
  setActiveRoot,
} from "./hooks";
import type { Root } from "./hooks";

export function renderRoot(root: Root): void {
  setActiveRoot(root);
  root.children = diffChildren(
    root.container,
    root.children,
    toChildArray(root.element),
    null,
  );
  setActiveRoot(null);
  flushEffects(root.children);
}

function sameType(a: VNodeType, b: VNodeType): boolean {
  if (a === b) {
    return true;
  }
  return (
    hmrActive &&
    typeof a === "function" &&
    typeof b === "function" &&
    canonical(a) === canonical(b)
  );
}

export function diffChildren(
  parentDom: Node,
  oldChildren: VNode[],
  newChildren: VNode[],
  anchor: Node | null,
): VNode[] {
  const matched: (VNode | null)[] = new Array(newChildren.length).fill(null);
  const moved: boolean[] = new Array(newChildren.length).fill(false);
  const removals: VNode[] = [];

  let lastPlacedIndex = 0;
  let index = 0;

  for (; index < oldChildren.length && index < newChildren.length; index++) {
    const oldChild = oldChildren[index];
    const newChild = newChildren[index];

    if (oldChild.key !== newChild.key) {
      break;
    }
    if (sameType(oldChild.type, newChild.type)) {
      matched[index] = oldChild;
      lastPlacedIndex = index;
    } else {
      removals.push(oldChild);
    }
  }

  if (index === newChildren.length) {
    for (let i = index; i < oldChildren.length; i++) {
      removals.push(oldChildren[i]);
    }
  } else {
    const existing = new Map<string | number, number>();
    for (let i = index; i < oldChildren.length; i++) {
      existing.set(oldChildren[i].key ?? i, i);
    }

    for (; index < newChildren.length; index++) {
      const newChild = newChildren[index];
      const mapKey = newChild.key ?? index;
      const oldIndex = existing.get(mapKey);

      if (oldIndex === undefined) {
        continue;
      }
      existing.delete(mapKey);

      const oldChild = oldChildren[oldIndex];
      if (!sameType(oldChild.type, newChild.type)) {
        removals.push(oldChild);
        continue;
      }
      matched[index] = oldChild;
      if (oldIndex < lastPlacedIndex) {
        moved[index] = true;
      } else {
        lastPlacedIndex = oldIndex;
      }
    }

    for (const oldIndex of existing.values()) {
      removals.push(oldChildren[oldIndex]);
    }
  }

  for (const oldChild of removals) {
    unmount(oldChild);
  }

  const result: VNode[] = new Array(newChildren.length);
  for (let i = newChildren.length - 1; i >= 0; i--) {
    const desc = newChildren[i];
    const oldChild = matched[i];

    if (oldChild === null) {
      result[i] = mount(desc, parentDom, anchor);
    } else {
      result[i] = patch(oldChild, desc, parentDom, anchor);
      if (moved[i]) {
        insert(result[i], parentDom, anchor);
      }
    }
    anchor = firstDom(result[i]) ?? anchor;
  }
  return result;
}

function instantiate(desc: VNode, previous: VNode | null): VNode {
  return {
    type: desc.type,
    key: desc.key,
    props: desc.props,
    dom: previous === null ? null : previous.dom,
    children: previous === null ? null : previous.children,
    hooks:
      previous !== null
        ? previous.hooks
        : typeof desc.type === "function"
          ? []
          : null,
    refCleanup: previous === null ? null : previous.refCleanup,
  };
}

export function mount(
  desc: VNode,
  parentDom: Node,
  anchor: Node | null,
): VNode {
  const vnode = instantiate(desc, null);

  if (vnode.type === Text) {
    vnode.dom = createDom(vnode, parentDom);
    parentDom.insertBefore(vnode.dom, anchor);
    return vnode;
  }
  if (typeof vnode.type === "string") {
    const dom = createDom(vnode, parentDom);
    vnode.dom = dom;
    vnode.children = vnode.props.dangerouslySetInnerHTML
      ? []
      : toChildArray(vnode.props.children).map((child) =>
          mount(child, dom, null),
        );
    parentDom.insertBefore(dom, anchor);
    attachRef(vnode);
    return vnode;
  }
  const rendered =
    typeof vnode.type === "function"
      ? renderComponent(vnode)
      : toChildArray(vnode.props.children);
  vnode.children = rendered.map((child) => mount(child, parentDom, anchor));
  return vnode;
}

function patch(
  oldVNode: VNode,
  desc: VNode,
  parentDom: Node,
  anchor: Node | null,
): VNode {
  const vnode = instantiate(desc, oldVNode);

  if (vnode.type === Text) {
    if (oldVNode.props.nodeValue !== vnode.props.nodeValue) {
      (vnode.dom as CharacterData).nodeValue = vnode.props.nodeValue;
    }
    return vnode;
  }
  if (typeof vnode.type === "string") {
    const dom = vnode.dom as Element;
    updateProps(dom, oldVNode.props, vnode.props);
    if (vnode.props.dangerouslySetInnerHTML) {
      for (const child of oldVNode.children ?? []) {
        unmount(child);
      }
      vnode.children = [];
    } else {
      vnode.children = diffChildren(
        dom,
        oldVNode.children ?? [],
        toChildArray(vnode.props.children),
        null,
      );
    }
    if (oldVNode.props.ref !== vnode.props.ref) {
      detachRef(vnode, oldVNode.props.ref);
      attachRef(vnode);
    }
    return vnode;
  }
  const rendered =
    typeof vnode.type === "function"
      ? renderComponent(vnode)
      : toChildArray(vnode.props.children);
  vnode.children = diffChildren(
    parentDom,
    oldVNode.children ?? [],
    rendered,
    anchor,
  );
  return vnode;
}

export function unmount(vnode: VNode): void {
  teardown(vnode);
  removeDoms(vnode);
}

function teardown(vnode: VNode): void {
  for (const child of vnode.children ?? []) {
    teardown(child);
  }
  runEffectCleanups(vnode);
  if (vnode.dom !== null) {
    detachRef(vnode);
  }
}

function removeDoms(vnode: VNode): void {
  if (vnode.dom !== null) {
    vnode.dom.parentNode?.removeChild(vnode.dom);
    return;
  }
  for (const child of vnode.children ?? []) {
    removeDoms(child);
  }
}

function insert(vnode: VNode, parentDom: Node, anchor: Node | null): void {
  if (vnode.dom !== null) {
    parentDom.insertBefore(vnode.dom, anchor);
    return;
  }
  for (const child of vnode.children ?? []) {
    insert(child, parentDom, anchor);
  }
}

function firstDom(vnode: VNode): Node | null {
  if (vnode.dom !== null) {
    return vnode.dom;
  }
  for (const child of vnode.children ?? []) {
    const dom = firstDom(child);
    if (dom !== null) {
      return dom;
    }
  }
  return null;
}
