import type { StaticValue } from "lit/static-html.js";

export type Constructor<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): T;
};

// From the TC39 Decorators proposal
export interface ClassDescriptor {
  kind: "class";
  elements: ClassElement[];
  finisher?: <T>(clazz: Constructor<T>) => void | Constructor<T>;
}

// From the TC39 Decorators proposal
export interface ClassElement {
  kind: "field" | "method";
  key: PropertyKey;
  placement: "static" | "prototype" | "own";
  initializer?: () => unknown;
  extras?: ClassElement[];
  finisher?: <T>(clazz: Constructor<T>) => void | Constructor<T>;
  descriptor?: PropertyDescriptor;
}

/**
 * Allow for custom element classes with private constructors
 */
export type CustomElementClass = Omit<typeof HTMLElement, "new">;

/**
 * A map of html tag names to the name of the html template literal to use when rendering it.
 * Defined by {@link @yukino.js/lit-jsx/core/elementRegistry}
 */
export type ElementRegistry = { [key: HTMLElement["tagName"]]: StaticValue };

/**
 * The top level HTMLElement to render all other components on.
 * User-created, handled in {@link @yukino.js/lit-jsx/core/createElement}
 */
export type RootElement = HTMLElement | DocumentFragment;
