import { isFunction } from "./index.js";
import isBrowser from "./is-browser.js";
import type { RefObject } from "react";

type TargetValue<T> = T | undefined | null;

type TargetType = HTMLElement | Element | Document | Window;

export type BasicTarget<T extends TargetType = Element> =
  | TargetValue<T>
  | (() => TargetValue<T>) // Getter
  | RefObject<TargetValue<T>>;

export function getTargetElement<T extends TargetType>(
  target: BasicTarget<T>,
  defaultElement?: T,
): TargetValue<T> {
  if (!isBrowser) {
    return undefined;
  }

  if (!target) {
    return defaultElement;
  }

  let targetElement: TargetValue<T>;

  // RefCallback<TargetValue<T>>

  // Getter
  if (isFunction(target)) {
    targetElement = target();

    // RefObject<TargetValue<T>>
  } else if ("current" in target) {
    targetElement = target.current;

    // TargetValue<T>
  } else {
    targetElement = target;
  }

  return targetElement;
}
