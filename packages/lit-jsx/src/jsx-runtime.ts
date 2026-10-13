import type { RefOrCallback } from "lit/directives/ref.js";
import type { StyleInfo } from "lit/directives/style-map.js";
import customElementRegistry from "./utils/custom-element-registry";
import createElement from "./core/create-element";

type NativeEventProps = {
  [EventName in keyof HTMLElementEventMap as `on${Capitalize<EventName>}`]?: (
    event: HTMLElementEventMap[EventName],
  ) => void;
};

/**
 * React-style camelCase spellings of multi-word DOM event names
 * (`onKeyDown` → `keydown`, `onDoubleClick` → `dblclick`, …). The runtime
 * lowercases any `onXxx` prop, so these aliases are type-level sugar over the
 * same native events; single-word events (`onClick`, `onInput`, …) are already
 * covered by `NativeEventProps`. Names missing from an older/newer
 * `HTMLElementEventMap` are filtered out instead of erroring.
 */
type ReactEventNames = {
  onAfterPrint: "afterprint";
  onAnimationCancel: "animationcancel";
  onAnimationEnd: "animationend";
  onAnimationIteration: "animationiteration";
  onAnimationStart: "animationstart";
  onAuxClick: "auxclick";
  onBeforeInput: "beforeinput";
  onBeforeMatch: "beforematch";
  onBeforePrint: "beforeprint";
  onBeforeToggle: "beforetoggle";
  onBeforeUnload: "beforeunload";
  onCanPlay: "canplay";
  onCanPlayThrough: "canplaythrough";
  onCompositionEnd: "compositionend";
  onCompositionStart: "compositionstart";
  onCompositionUpdate: "compositionupdate";
  onContextLost: "contextlost";
  onContextMenu: "contextmenu";
  onContextRestored: "contextrestored";
  onCueChange: "cuechange";
  onDoubleClick: "dblclick";
  onDragEnd: "dragend";
  onDragEnter: "dragenter";
  onDragExit: "dragexit";
  onDragLeave: "dragleave";
  onDragOver: "dragover";
  onDragStart: "dragstart";
  onDurationChange: "durationchange";
  onFocusIn: "focusin";
  onFocusOut: "focusout";
  onFormData: "formdata";
  onFullscreenChange: "fullscreenchange";
  onFullscreenError: "fullscreenerror";
  onGamepadConnected: "gamepadconnected";
  onGamepadDisconnected: "gamepaddisconnected";
  onGotPointerCapture: "gotpointercapture";
  onHashChange: "hashchange";
  onKeyDown: "keydown";
  onKeyPress: "keypress";
  onKeyUp: "keyup";
  onLanguageChange: "languagechange";
  onLoadedData: "loadeddata";
  onLoadedMetadata: "loadedmetadata";
  onLoadStart: "loadstart";
  onLostPointerCapture: "lostpointercapture";
  onMessageError: "messageerror";
  onMouseDown: "mousedown";
  onMouseEnter: "mouseenter";
  onMouseLeave: "mouseleave";
  onMouseMove: "mousemove";
  onMouseOut: "mouseout";
  onMouseOver: "mouseover";
  onMouseUp: "mouseup";
  onPageHide: "pagehide";
  onPageReveal: "pagereveal";
  onPageShow: "pageshow";
  onPageSwap: "pageswap";
  onPointerCancel: "pointercancel";
  onPointerDown: "pointerdown";
  onPointerEnter: "pointerenter";
  onPointerLeave: "pointerleave";
  onPointerMove: "pointermove";
  onPointerOut: "pointerout";
  onPointerOver: "pointerover";
  onPointerRawUpdate: "pointerrawupdate";
  onPointerUp: "pointerup";
  onPopState: "popstate";
  onRateChange: "ratechange";
  onScrollEnd: "scrollend";
  onSecurityPolicyViolation: "securitypolicyviolation";
  onSelectionChange: "selectionchange";
  onSelectStart: "selectstart";
  onSlotChange: "slotchange";
  onTimeUpdate: "timeupdate";
  onTouchCancel: "touchcancel";
  onTouchEnd: "touchend";
  onTouchMove: "touchmove";
  onTouchStart: "touchstart";
  onTransitionCancel: "transitioncancel";
  onTransitionEnd: "transitionend";
  onTransitionRun: "transitionrun";
  onTransitionStart: "transitionstart";
  onVolumeChange: "volumechange";
  onWebkitAnimationEnd: "webkitanimationend";
  onWebkitAnimationIteration: "webkitanimationiteration";
  onWebkitAnimationStart: "webkitanimationstart";
  onWebkitTransitionEnd: "webkittransitionend";
};

type ReactEventProps = {
  [
    PropName in keyof ReactEventNames as ReactEventNames[PropName] extends keyof HTMLElementEventMap
      ? PropName
      : never
  ]?: (
    event: HTMLElementEventMap[ReactEventNames[PropName] &
      keyof HTMLElementEventMap],
  ) => void;
};

type EventProps = NativeEventProps & ReactEventProps;

/**
 * The literal (non-index-signature) keys of `T`. Some elements — notably
 * `<form>` with its `[name: string]: any` — carry string index signatures,
 * and `keyof` then collapses to `string`, which would erase every key from
 * an `Omit<..., keyof T>`. Filtering the index keys keeps the Omit precise.
 */
type KnownKeys<T> = keyof {
  [
    K in keyof T as string extends K
      ? never
      : number extends K
        ? never
        : symbol extends K
          ? never
          : K
  ]: T[K];
};

/**
 * React-compatible widening of `value`/`defaultValue`: string-valued DOM
 * properties also accept numbers (and string arrays, for `<select multiple>`),
 * number-valued ones also accept strings. Elements without these properties
 * keep accepting anything through the index signature.
 */
type ValueProps<T extends Element> = {
  [K in Extract<keyof T, "value" | "defaultValue">]?: [Partial<T>[K]] extends [
    string | undefined,
  ]
    ? Partial<T>[K] | number | readonly string[] | null
    : [Partial<T>[K]] extends [number | undefined]
      ? Partial<T>[K] | string | null
      : Partial<T>[K];
};

type ElementProps<T extends Element> = Omit<
  Partial<T>,
  "children" | "style" | "value" | "defaultValue"
> &
  // An element's own declared `onXxx` properties (e.g. callback properties on
  // custom elements) win over the native event-handler spellings instead of
  // intersecting into an uncallable function type.
  Omit<EventProps, KnownKeys<T>> &
  ValueProps<T> & {
    children?: unknown;
    ref?: RefOrCallback<T>;
    style?: Readonly<StyleInfo>;
    [property: string]: unknown;
  };

// eslint-disable-next-line @typescript-eslint/no-namespace -- TypeScript requires this namespace for automatic JSX runtime types.
export namespace JSX {
  export type Element = unknown;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  export interface IntrinsicAttributes {
    key?: string | number;
    [property: string]: unknown;
  }

  export type IntrinsicElements = {
    [TagName in keyof HTMLElementTagNameMap]: ElementProps<
      HTMLElementTagNameMap[TagName]
    >;
  } & {
    [tagName: string]: ElementProps<HTMLElement>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function jsx(type: string | Function, config: Record<string, unknown>) {
  if (typeof type === "function") {
    if (type.prototype instanceof HTMLElement) {
      let tagName = customElementRegistry.get(type);
      if (!tagName) {
        const CustomElement = type as new () => HTMLElement;
        const element = new CustomElement();
        tagName = element.localName;
        customElementRegistry.set(type, tagName);
      }
      return createElement(tagName, config);
    }
    return type(config);
  }
  return createElement(type, config);
}

function jsxFragment(fragment: { children?: unknown }) {
  return Array.isArray(fragment.children)
    ? fragment.children
    : [fragment.children];
}

export { jsx, jsx as jsxs, jsx as jsxDEV, jsxFragment as Fragment };
