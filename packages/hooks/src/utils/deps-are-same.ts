import type { DependencyList } from "react";

export function depsAreSame(oldDeps: DependencyList, deps: DependencyList) {
  if (oldDeps === deps) {
    return true;
  }

  for (let i = 0; i < oldDeps.length; i++) {
    // oldDeps[i] === deps[i] 和 Object.is() 区别
    // Object.is() 会考虑 NaN 等特殊值
    // NaN === NaN -> false
    // Object.is(NaN, NaN) -> true
    if (!Object.is(oldDeps[i], deps[i])) {
      return false;
    }
  }
  return true;
}
