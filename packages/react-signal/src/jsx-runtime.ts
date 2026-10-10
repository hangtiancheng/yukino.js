import type { JSXInternal } from "./jsx/dom-types";
import {
  createVNode,
  Fragment,
  raw,
  type Component,
  type JSXNode,
  type VNode,
} from "./jsx/vnode";

export { Fragment, raw };
export type { Component, JSXNode, VNode };

export type * from "./jsx/dom-types";

export function jsx(
  type: string | Component | symbol,
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
): VNode {
  return createVNode(type, props, key);
}

export const jsxs = jsx;

export declare namespace JSX {
  type Element = VNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ElementType = string | Component<any> | symbol;
  interface ElementChildrenAttribute {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    children: {};
  }
  interface IntrinsicAttributes {
    key?: string | number;
  }
  interface IntrinsicElements extends JSXInternal.IntrinsicElements {}

  export type Signalish<T> = JSXInternal.Signalish<T>;
  export type ClassValue = JSXInternal.ClassValue;
  export type RefCallback<T> = JSXInternal.RefCallback<T>;
  export type RefObject<T> = JSXInternal.RefObject<T>;
  export type Ref<T> = JSXInternal.Ref<T>;
  export type ClassAttributes<T> = JSXInternal.ClassAttributes<T>;
  export type ToggleEvent = JSXInternal.ToggleEvent;
  export type CommandEvent = JSXInternal.CommandEvent;
  export type SnapEvent = JSXInternal.SnapEvent;
  export type Booleanish = JSXInternal.Booleanish;
  export type DOMCSSProperties = JSXInternal.DOMCSSProperties;
  export type AllCSSProperties = JSXInternal.AllCSSProperties;
  export type CSSProperties = JSXInternal.CSSProperties;
  export type SVGAttributes<Target extends EventTarget = SVGElement> =
    JSXInternal.SVGAttributes<Target>;
  export type TargetedEvent<
    Target extends EventTarget = EventTarget,
    TypedEvent extends Event = Event,
  > = JSXInternal.TargetedEvent<Target, TypedEvent>;
  export type TargetedAnimationEvent<Target extends EventTarget> =
    JSXInternal.TargetedAnimationEvent<Target>;
  export type TargetedClipboardEvent<Target extends EventTarget> =
    JSXInternal.TargetedClipboardEvent<Target>;
  export type TargetedCommandEvent<Target extends EventTarget> =
    JSXInternal.TargetedCommandEvent<Target>;
  export type TargetedCompositionEvent<Target extends EventTarget> =
    JSXInternal.TargetedCompositionEvent<Target>;
  export type TargetedDragEvent<Target extends EventTarget> =
    JSXInternal.TargetedDragEvent<Target>;
  export type TargetedFocusEvent<Target extends EventTarget> =
    JSXInternal.TargetedFocusEvent<Target>;
  export type TargetedInputEvent<Target extends EventTarget> =
    JSXInternal.TargetedInputEvent<Target>;
  export type TargetedKeyboardEvent<Target extends EventTarget> =
    JSXInternal.TargetedKeyboardEvent<Target>;
  export type TargetedMouseEvent<Target extends EventTarget> =
    JSXInternal.TargetedMouseEvent<Target>;
  export type TargetedPointerEvent<Target extends EventTarget> =
    JSXInternal.TargetedPointerEvent<Target>;
  export type TargetedSnapEvent<Target extends EventTarget> =
    JSXInternal.TargetedSnapEvent<Target>;
  export type TargetedSubmitEvent<Target extends EventTarget> =
    JSXInternal.TargetedSubmitEvent<Target>;
  export type TargetedTouchEvent<Target extends EventTarget> =
    JSXInternal.TargetedTouchEvent<Target>;
  export type TargetedToggleEvent<Target extends EventTarget> =
    JSXInternal.TargetedToggleEvent<Target>;
  export type TargetedTransitionEvent<Target extends EventTarget> =
    JSXInternal.TargetedTransitionEvent<Target>;
  export type TargetedUIEvent<Target extends EventTarget> =
    JSXInternal.TargetedUIEvent<Target>;
  export type TargetedWheelEvent<Target extends EventTarget> =
    JSXInternal.TargetedWheelEvent<Target>;
  export type TargetedPictureInPictureEvent<Target extends EventTarget> =
    JSXInternal.TargetedPictureInPictureEvent<Target>;
  export type EventHandler<E extends TargetedEvent> =
    JSXInternal.EventHandler<E>;
  export type AnimationEventHandler<Target extends EventTarget> =
    JSXInternal.AnimationEventHandler<Target>;
  export type ClipboardEventHandler<Target extends EventTarget> =
    JSXInternal.ClipboardEventHandler<Target>;
  export type CommandEventHandler<Target extends EventTarget> =
    JSXInternal.CommandEventHandler<Target>;
  export type CompositionEventHandler<Target extends EventTarget> =
    JSXInternal.CompositionEventHandler<Target>;
  export type DragEventHandler<Target extends EventTarget> =
    JSXInternal.DragEventHandler<Target>;
  export type ToggleEventHandler<Target extends EventTarget> =
    JSXInternal.ToggleEventHandler<Target>;
  export type FocusEventHandler<Target extends EventTarget> =
    JSXInternal.FocusEventHandler<Target>;
  export type GenericEventHandler<Target extends EventTarget> =
    JSXInternal.GenericEventHandler<Target>;
  export type InputEventHandler<Target extends EventTarget> =
    JSXInternal.InputEventHandler<Target>;
  export type KeyboardEventHandler<Target extends EventTarget> =
    JSXInternal.KeyboardEventHandler<Target>;
  export type MouseEventHandler<Target extends EventTarget> =
    JSXInternal.MouseEventHandler<Target>;
  export type PointerEventHandler<Target extends EventTarget> =
    JSXInternal.PointerEventHandler<Target>;
  export type SnapEventHandler<Target extends EventTarget> =
    JSXInternal.SnapEventHandler<Target>;
  export type SubmitEventHandler<Target extends EventTarget> =
    JSXInternal.SubmitEventHandler<Target>;
  export type TouchEventHandler<Target extends EventTarget> =
    JSXInternal.TouchEventHandler<Target>;
  export type TransitionEventHandler<Target extends EventTarget> =
    JSXInternal.TransitionEventHandler<Target>;
  export type UIEventHandler<Target extends EventTarget> =
    JSXInternal.UIEventHandler<Target>;
  export type WheelEventHandler<Target extends EventTarget> =
    JSXInternal.WheelEventHandler<Target>;
  export type PictureInPictureEventHandler<Target extends EventTarget> =
    JSXInternal.PictureInPictureEventHandler<Target>;
  export type DOMAttributes<Target extends EventTarget> =
    JSXInternal.DOMAttributes<Target>;
  export type AriaAttributes = JSXInternal.AriaAttributes;
  export type WAIAriaRole = JSXInternal.WAIAriaRole;
  export type DPubAriaRole = JSXInternal.DPubAriaRole;
  export type AriaRole = JSXInternal.AriaRole;
  export type AllHTMLAttributes<RefType extends EventTarget = EventTarget> =
    JSXInternal.AllHTMLAttributes<RefType>;
  export type HTMLAttributes<RefType extends EventTarget = EventTarget> =
    JSXInternal.HTMLAttributes<RefType>;
  export type MathMLAttributes<Target extends EventTarget = MathMLElement> =
    JSXInternal.MathMLAttributes<Target>;
  export type AnnotationMathMLAttributes<T extends EventTarget> =
    JSXInternal.AnnotationMathMLAttributes<T>;
  export type AnnotationXmlMathMLAttributes<T extends EventTarget> =
    JSXInternal.AnnotationXmlMathMLAttributes<T>;
  export type MActionMathMLAttributes<T extends EventTarget> =
    JSXInternal.MActionMathMLAttributes<T>;
  export type MathMathMLAttributes<T extends EventTarget> =
    JSXInternal.MathMathMLAttributes<T>;
  export type MEncloseMathMLAttributes<T extends EventTarget> =
    JSXInternal.MEncloseMathMLAttributes<T>;
  export type MErrorMathMLAttributes<T extends EventTarget> =
    JSXInternal.MErrorMathMLAttributes<T>;
  export type MFencedMathMLAttributes<T extends EventTarget> =
    JSXInternal.MFencedMathMLAttributes<T>;
  export type MFracMathMLAttributes<T extends EventTarget> =
    JSXInternal.MFracMathMLAttributes<T>;
  export type MiMathMLAttributes<T extends EventTarget> =
    JSXInternal.MiMathMLAttributes<T>;
  export type MmultiScriptsMathMLAttributes<T extends EventTarget> =
    JSXInternal.MmultiScriptsMathMLAttributes<T>;
  export type MNMathMLAttributes<T extends EventTarget> =
    JSXInternal.MNMathMLAttributes<T>;
  export type MOMathMLAttributes<T extends EventTarget> =
    JSXInternal.MOMathMLAttributes<T>;
  export type MOverMathMLAttributes<T extends EventTarget> =
    JSXInternal.MOverMathMLAttributes<T>;
  export type MPaddedMathMLAttributes<T extends EventTarget> =
    JSXInternal.MPaddedMathMLAttributes<T>;
  export type MPhantomMathMLAttributes<T extends EventTarget> =
    JSXInternal.MPhantomMathMLAttributes<T>;
  export type MPrescriptsMathMLAttributes<T extends EventTarget> =
    JSXInternal.MPrescriptsMathMLAttributes<T>;
  export type MRootMathMLAttributes<T extends EventTarget> =
    JSXInternal.MRootMathMLAttributes<T>;
  export type MRowMathMLAttributes<T extends EventTarget> =
    JSXInternal.MRowMathMLAttributes<T>;
  export type MSMathMLAttributes<T extends EventTarget> =
    JSXInternal.MSMathMLAttributes<T>;
  export type MSpaceMathMLAttributes<T extends EventTarget> =
    JSXInternal.MSpaceMathMLAttributes<T>;
  export type MSqrtMathMLAttributes<T extends EventTarget> =
    JSXInternal.MSqrtMathMLAttributes<T>;
  export type MStyleMathMLAttributes<T extends EventTarget> =
    JSXInternal.MStyleMathMLAttributes<T>;
  export type MSubMathMLAttributes<T extends EventTarget> =
    JSXInternal.MSubMathMLAttributes<T>;
  export type MSubsupMathMLAttributes<T extends EventTarget> =
    JSXInternal.MSubsupMathMLAttributes<T>;
  export type MSupMathMLAttributes<T extends EventTarget> =
    JSXInternal.MSupMathMLAttributes<T>;
  export type MTableMathMLAttributes<T extends EventTarget> =
    JSXInternal.MTableMathMLAttributes<T>;
  export type MTdMathMLAttributes<T extends EventTarget> =
    JSXInternal.MTdMathMLAttributes<T>;
  export type MTextMathMLAttributes<T extends EventTarget> =
    JSXInternal.MTextMathMLAttributes<T>;
  export type MTrMathMLAttributes<T extends EventTarget> =
    JSXInternal.MTrMathMLAttributes<T>;
  export type MUnderMathMLAttributes<T extends EventTarget> =
    JSXInternal.MUnderMathMLAttributes<T>;
  export type MUnderoverMathMLAttributes<T extends EventTarget> =
    JSXInternal.MUnderoverMathMLAttributes<T>;
  export type SemanticsMathMLAttributes<T extends EventTarget> =
    JSXInternal.SemanticsMathMLAttributes<T>;
  export type IntrinsicSVGElements = JSXInternal.IntrinsicSVGElements;
  export type IntrinsicMathMLElements = JSXInternal.IntrinsicMathMLElements;
}
