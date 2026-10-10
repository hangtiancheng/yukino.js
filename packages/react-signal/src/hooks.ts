import {
  signal,
  computed,
  effect,
  type Signal,
  type ReadonlySignal,
} from "./reactive";
import { requireInstance, useValueSlot, useMountSlot } from "./component";

export function useSignal<T>(initial: T): Signal<T> {
  return useValueSlot(() => signal(initial), undefined, true);
}

export function useRef<T = Element>(
  initial: T | null = null,
): { current: T | null } {
  return useValueSlot(() => ({ current: initial }), undefined, true);
}

export function useComputed<T>(fn: () => T): ReadonlySignal<T> {
  return useValueSlot(() => computed(fn));
}

export function useSignalEffect(fn: () => void | (() => void)): void {
  useValueSlot(
    () => effect(fn),
    (dispose) => (dispose as () => void)(),
  );
}

export function useEffect(fn: () => void | (() => void)): void {
  useMountSlot(fn);
}

export function onCleanup(fn: () => void): void {
  requireInstance("onCleanup");
  useValueSlot(
    () => fn,
    (value) => (value as () => void)(),
  );
}
