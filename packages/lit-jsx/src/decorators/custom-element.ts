import type {
  CustomElementClass,
  ClassDescriptor,
  Constructor,
} from "../types";
import customElementRegistry from "../utils/custom-element-registry";

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
    finisher(clazz: Constructor<HTMLElement>) {
      customElements.define(tagName, clazz);
    },
  };
};

export const customElement =
  (tagName: string) =>
  <C extends CustomElementClass | ClassDescriptor>(classOrDescriptor: C): C => {
    customElementRegistry.set(classOrDescriptor, tagName);
    return typeof classOrDescriptor === "function"
      ? (legacyCustomElement(tagName, classOrDescriptor) as C)
      : (standardCustomElement(
          tagName,
          classOrDescriptor as ClassDescriptor,
        ) as C);
  };
