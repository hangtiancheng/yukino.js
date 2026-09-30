import type {
  CustomElementClass,
  ClassDescriptor,
  Constructor,
} from "../types";
import customElementRegistry from "../utils/custom-element-registry";

/*
 * IMPORTANT: For compatibility with tsickle and the Closure JS compiler, all
 * property decorators (but not class decorators) in this file that have
 * an @ExportDecoratedItems annotation must be defined as a regular function,
 * not an arrow function.
 */

const legacyCustomElement = (tagName: string, clazz: CustomElementClass) => {
  customElements.define(tagName, clazz as CustomElementConstructor);
  return clazz;
};

const standardCustomElement = (
  tagName: string,
  descriptor: ClassDescriptor,
) => {
  const { kind, elements } = descriptor;
  return {
    kind,
    elements,
    // This callback is called once the class is otherwise fully defined
    finisher(clazz: Constructor<HTMLElement>) {
      customElements.define(tagName, clazz);
    },
  };
};

/**
 * Class decorator factory that defines the decorated class as a custom element.
 *
 * ```js
 * @customElement('my-element')
 * class MyElement extends LitElement {
 *   render() {
 *     return html``;
 *   }
 * }
 * ```
 * @category Decorator
 * @param tagName The tag name of the custom element to define.
 */
export const customElement =
  (tagName: string) =>
  <C extends CustomElementClass | ClassDescriptor>(classOrDescriptor: C): C => {
    // ***********************
    // This is the difference.
    customElementRegistry.set(classOrDescriptor, tagName);
    // ***********************
    // The generic identity return keeps decorated classes' types intact:
    // legacy decorators are applied to the class expression itself, and TS
    // can't verify that `CustomElementClass` is assignable to the decorated
    // class type, so the branch result is asserted here.
    return typeof classOrDescriptor === "function"
      ? (legacyCustomElement(tagName, classOrDescriptor) as C)
      : (standardCustomElement(
          tagName,
          classOrDescriptor as ClassDescriptor,
        ) as C);
  };
