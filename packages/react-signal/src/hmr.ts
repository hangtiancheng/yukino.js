import { batch } from "./reactive";
import { aliasComponent } from "./component-registry";
import { getInstances, swapInstanceFn } from "./component";
import type { Component } from "./jsx/vnode";

export function hotSwapByComponent(oldFn: unknown, newFn: unknown): boolean {
  if (
    typeof oldFn !== "function" ||
    typeof newFn !== "function" ||
    oldFn === newFn
  ) {
    return false;
  }
  const oldC = oldFn as Component;
  const newC = newFn as Component;
  aliasComponent(oldC, newC);
  const instances = Array.from(getInstances(oldC));
  batch(() => {
    for (const inst of instances) {
      swapInstanceFn(inst, newC);
      inst.invalidate.value++;
    }
  });
  return instances.length > 0;
}
