import { useMemo, useRef } from "react";
import isDev from "../utils/is-dev.js";

type anyFunc = (this: any, ...args: any[]) => any;

type PickFunction<T extends anyFunc> = (
  this: ThisParameterType<T>,
  ...args: Parameters<T>
) => ReturnType<T>;

export function useMemorizedFn<T extends anyFunc>(fn: T): PickFunction<T> {
  if (isDev) {
  }

  const fnRef = useRef<T>(fn);
  fnRef.current = useMemo<T>(() => fn, [fn]);

  const memoizedFn = useRef<PickFunction<T> | undefined>(undefined);
  if (!memoizedFn.current) {
    memoizedFn.current = function (
      this: ThisParameterType<T>,
      ...args: Parameters<T>
    ) {
      return fnRef.current.apply(this, args);
    };
  }

  return memoizedFn.current;
}

export default useMemorizedFn;

export function usePersistFn<T extends anyFunc>(fn: T): PickFunction<T> {
  if (isDev) {
  }

  const fnRef = useRef<T>(fn);

  const memoizedFn = useRef<PickFunction<T> | undefined>(undefined);
  if (!memoizedFn.current) {
    memoizedFn.current = function (
      this: ThisParameterType<T>,
      ...args: Parameters<T>
    ) {
      return fnRef.current.apply(this, args);
    };
  }

  return memoizedFn.current;
}
