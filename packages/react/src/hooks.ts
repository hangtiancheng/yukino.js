import { toChildArray } from "./element";
import type { Children, ComponentType, VNode } from "./element";
import { canonical, hmrActive } from "./hmr";

export interface Root {
  container: Node;
  element: Children;
  children: VNode[];
  schedule(): void;
}

export type SetStateAction<S> = S | ((prev: S) => S);
export type Dispatch<A> = (action: A) => void;
export type EffectCallback = () => void | (() => void);
export type DepList = readonly unknown[];

interface StateHook {
  tag: "state";
  state: any;
  queue: SetStateAction<any>[];
  setState: Dispatch<SetStateAction<any>>;
}

interface EffectHook {
  tag: "effect";
  create: EffectCallback;
  deps: DepList | null;
  cleanup: (() => void) | null;
  changed: boolean;
}

interface MemoHook {
  tag: "memo";
  value: any;
  deps: DepList;
}

export type Hook = StateHook | EffectHook | MemoHook;

let activeRoot: Root | null = null;
let currentHooks: Hook[] | null = null;
let hookIndex = 0;

export function setActiveRoot(root: Root | null): void {
  activeRoot = root;
}

export function renderComponent(vnode: VNode): VNode[] {
  const hooks = vnode.hooks!;
  currentHooks = hooks;
  hookIndex = 0;
  const fn = hmrActive
    ? canonical(vnode.type as ComponentType)
    : (vnode.type as ComponentType);
  const rendered = fn(vnode.props);
  currentHooks = null;
  if (hookIndex < hooks.length) {
    for (let i = hookIndex; i < hooks.length; i++) {
      const slot = hooks[i];
      if (slot.tag === "effect" && slot.cleanup) {
        slot.cleanup();
      }
    }
    hooks.length = hookIndex;
  }
  return toChildArray(rendered);
}

function getSlot<H extends Hook>(tag: H["tag"], create: () => H): [H, boolean] {
  if (currentHooks === null) {
    throw new Error("Hooks can only be called inside a function component.");
  }
  const index = hookIndex++;
  if (index === currentHooks.length) {
    const slot = create();
    currentHooks.push(slot);
    return [slot, true];
  }
  const slot = currentHooks[index];
  if (slot.tag !== tag) {
    if (slot.tag === "effect" && slot.cleanup) {
      slot.cleanup();
    }
    const fresh = create();
    currentHooks[index] = fresh;
    return [fresh, true];
  }
  return [slot as H, false];
}

export function useState<S>(
  initialState: S | (() => S),
): [S, Dispatch<SetStateAction<S>>] {
  const [slot] = getSlot<StateHook>("state", () => {
    const root = activeRoot!;
    const created: StateHook = {
      tag: "state",
      state:
        typeof initialState === "function"
          ? (initialState as () => S)()
          : initialState,
      queue: [],
      setState: (action) => {
        if (created.queue.length === 0) {
          const eager =
            typeof action === "function"
              ? (action as (prev: S) => S)(created.state)
              : action;
          if (Object.is(eager, created.state)) {
            return;
          }
        }
        created.queue.push(action);
        root.schedule();
      },
    };
    return created;
  });

  for (const action of slot.queue) {
    slot.state = typeof action === "function" ? action(slot.state) : action;
  }
  slot.queue.length = 0;

  return [slot.state, slot.setState];
}

export function useEffect(create: EffectCallback, deps?: DepList): void {
  const [slot, mounted] = getSlot<EffectHook>("effect", () => ({
    tag: "effect",
    create,
    deps: deps ?? null,
    cleanup: null,
    changed: true,
  }));
  if (!mounted) {
    slot.changed = !depsEqual(slot.deps, deps ?? null);
    slot.create = create;
    slot.deps = deps ?? null;
  }
}

export function useMemo<T>(factory: () => T, deps: DepList): T {
  const [slot, mounted] = getSlot<MemoHook>("memo", () => ({
    tag: "memo",
    value: factory(),
    deps,
  }));
  if (!mounted && !depsEqual(slot.deps, deps)) {
    slot.value = factory();
    slot.deps = deps;
  }
  return slot.value as T;
}

export function useCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps: DepList,
): T {
  return useMemo(() => callback, deps);
}

export function useRef<T>(initialValue: T): { current: T } {
  return useMemo(() => ({ current: initialValue }), []);
}

function depsEqual(prev: DepList | null, next: DepList | null): boolean {
  if (prev === null || next === null || prev.length !== next.length) {
    return false;
  }
  return prev.every((dep, index) => Object.is(dep, next[index]));
}

export function flushEffects(children: VNode[]): void {
  walk(children, (vnode) => {
    for (const slot of vnode.hooks ?? []) {
      if (slot.tag === "effect" && slot.changed && slot.cleanup) {
        slot.cleanup();
        slot.cleanup = null;
      }
    }
  });
  walk(children, (vnode) => {
    for (const slot of vnode.hooks ?? []) {
      if (slot.tag === "effect" && slot.changed) {
        slot.changed = false;
        const cleanup = slot.create();
        slot.cleanup = typeof cleanup === "function" ? cleanup : null;
      }
    }
  });
}

export function runEffectCleanups(vnode: VNode): void {
  for (const slot of vnode.hooks ?? []) {
    if (slot.tag === "effect" && slot.cleanup) {
      slot.cleanup();
      slot.cleanup = null;
    }
  }
}

function walk(children: VNode[] | null, visit: (vnode: VNode) => void): void {
  if (children === null) {
    return;
  }
  for (const vnode of children) {
    walk(vnode.children, visit);
    visit(vnode);
  }
}
