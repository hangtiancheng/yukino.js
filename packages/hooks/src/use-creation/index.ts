// readonly unknown[]
import type { DependencyList } from "react";
import { useRef } from "react";
import { depsAreSame } from "../utils/deps-are-same.js";

/**
 *
 * @description `useCreation` 可以保证, 依赖项数组不改变时, 工厂函数只执行 1 次
 */
function useCreation<T>(factory: () => T, deps: DependencyList): T {
  const { current } = useRef<{
    deps: DependencyList;
    obj: T | undefined;
    initialized: boolean;
  }>({
    deps,
    obj: undefined,
    initialized: false,
  });

  if (!current.initialized || !depsAreSame(current.deps, deps)) {
    current.deps = deps;
    current.obj = factory();
    current.initialized = true;
  }

  return current.obj as T;
}

export default useCreation;
