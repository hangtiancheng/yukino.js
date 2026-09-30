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

/**
 * Render a root: diff a fresh instance tree, commit it synchronously, then
 * flush effects in a single pass. Non-interruptible — a single call runs
 * start to finish.
 */
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

/**
 * Tag identity. Plain `===` in production; once HMR performed a swap,
 * component functions also match through the alias chain, so stale
 * descriptors (an old `root.element`, a `useMemo`-cached element) keep
 * matching hot-swapped instances.
 */
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

/**
 * Same-level child diff, built on React's three assumptions (reducing O(n^3)
 * to O(n)):
 *   1. Only compare within the same level; any cross-level move is treated as
 *      "unmount + create";
 *   2. A changed type means the entire subtree is non-reusable;
 *   3. A key identifies "the same node" within a level; without keys it falls
 *      back to index-based comparison.
 *
 * Two passes: the first compares positionally left to right and stops at the
 * first key mismatch; the second indexes the remaining old nodes into a
 * key -> index Map and consumes them in new-list order. Both passes share the
 * lastPlacedIndex watermark to decide whether a reused node must be moved.
 *
 * @param parentDom   The host parent that contains these children
 * @param oldChildren The previous child instances (carrying dom / hooks)
 * @param newChildren The normalized new descriptors
 * @param anchor      The host node immediately to the right of this run of
 *                    children, or null to append at the end
 * @returns The new list of child instances
 */
export function diffChildren(
  parentDom: Node,
  oldChildren: VNode[],
  newChildren: VNode[],
  anchor: Node | null,
): VNode[] {
  /** The old instance each new node matched, or null if it must be created */
  const matched: (VNode | null)[] = new Array(newChildren.length).fill(null);
  /** Whether a reused node still needs to be moved into position */
  const moved: boolean[] = new Array(newChildren.length).fill(false);
  /** Old instances that were not reused and must be unmounted */
  const removals: VNode[] = [];

  // The largest old index among reused nodes that kept their relative order
  let lastPlacedIndex = 0;
  let index = 0;

  // Pass one: positional comparison. The most common changes — appends/truncations
  // at the tail and pure props updates — finish here without building a Map.
  // Old and new indices are equal in this pass, so reused nodes never move.
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
      // Same key but changed type: not reusable, drop the old node along with its DOM
      removals.push(oldChild);
    }
  }

  if (index === newChildren.length) {
    // The new list ran out first; the leftover old nodes are all surplus
    for (let i = index; i < oldChildren.length; i++) {
      removals.push(oldChildren[i]);
    }
  } else {
    // Pass two: index the remaining old nodes by key (old index when keyless), then look them up in new-list order
    const existing = new Map<string | number, number>();
    for (let i = index; i < oldChildren.length; i++) {
      existing.set(oldChildren[i].key ?? i, i);
    }

    for (; index < newChildren.length; index++) {
      const newChild = newChildren[index];
      const mapKey = newChild.key ?? index;
      const oldIndex = existing.get(mapKey);

      if (oldIndex === undefined) {
        continue; // Brand-new node, left for mounting later
      }
      existing.delete(mapKey);

      const oldChild = oldChildren[oldIndex];
      if (!sameType(oldChild.type, newChild.type)) {
        removals.push(oldChild);
        continue;
      }
      matched[index] = oldChild;
      if (oldIndex < lastPlacedIndex) {
        // Old index falls behind the watermark: it landed after a "stationary" sibling, so it must move
        moved[index] = true;
      } else {
        // Stays in place; raise the watermark to its old index
        lastPlacedIndex = oldIndex;
      }
    }

    for (const oldIndex of existing.values()) {
      removals.push(oldChildren[oldIndex]);
    }
  }

  // Unmount first, so nodes pending removal don't pollute insertion-position calculations
  for (const oldChild of removals) {
    unmount(oldChild);
  }

  // Commit right to left: when we reach index i, all siblings to its right are
  // already in their final position, so anchor is the first host node of the
  // right neighbor. This avoids searching upward for an anchor and naturally
  // supports the one-to-many DOM case of components / Fragments.
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

/** Build an instance from a descriptor; when previous is non-null, carry over dom / children / hooks / refCleanup */
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

/** Mount a new subtree, inserting the produced host nodes before anchor */
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
    // Children are inserted into the parent before it enters the tree, so the whole subtree triggers only one real mount
    vnode.children = vnode.props.dangerouslySetInnerHTML
      ? []
      : toChildArray(vnode.props.children).map((child) =>
          mount(child, dom, null),
        );
    parentDom.insertBefore(dom, anchor);
    attachRef(vnode);
    return vnode;
  }
  // Function components / Fragments produce no DOM of their own; children mount directly onto the same host parent
  const rendered =
    typeof vnode.type === "function"
      ? renderComponent(vnode)
      : toChildArray(vnode.props.children);
  vnode.children = rendered.map((child) => mount(child, parentDom, anchor));
  return vnode;
}

/** Reuse an old instance; the caller guarantees type and key are identical */
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
      // updateProps just rewrote innerHTML; the old child instances lost their
      // DOM already, but their effect cleanups / refs must still run
      for (const child of oldVNode.children ?? []) {
        unmount(child);
      }
      vnode.children = [];
    } else {
      // Children live inside their own dom with nothing to the right, so the anchor is null
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

/** Unmount: tear down the subtree (children before parents), then detach the topmost host nodes */
export function unmount(vnode: VNode): void {
  teardown(vnode);
  removeDoms(vnode);
}

/** One walk per unmount: effect cleanups and ref detachment, children first */
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

/**
 * Move an already-mounted subtree: insertBefore relocates nodes that are
 * already in the document, so "move" and "insert" are the same operation.
 */
function insert(vnode: VNode, parentDom: Node, anchor: Node | null): void {
  if (vnode.dom !== null) {
    parentDom.insertBefore(vnode.dom, anchor);
    return;
  }
  for (const child of vnode.children ?? []) {
    insert(child, parentDom, anchor);
  }
}

/** The first host node in a subtree, used as the insertion anchor for the left neighbor */
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
