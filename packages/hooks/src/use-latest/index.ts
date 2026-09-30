import { useRef, type RefObject } from "react";

function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef<T>(value);
  ref.current = value;
  return ref;
}

export default useLatest;
