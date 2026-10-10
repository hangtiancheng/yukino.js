import type { StaticValue } from "lit/static-html.js";

export type Constructor<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): T;
};

export interface ClassDescriptor {
  kind: "class";
  elements: ClassElement[];
  finisher?: <T>(clazz: Constructor<T>) => void | Constructor<T>;
}

export interface ClassElement {
  kind: "field" | "method";
  key: PropertyKey;
  placement: "static" | "prototype" | "own";
  initializer?: () => unknown;
  extras?: ClassElement[];
  finisher?: <T>(clazz: Constructor<T>) => void | Constructor<T>;
  descriptor?: PropertyDescriptor;
}

export type CustomElementClass = Omit<typeof HTMLElement, "new">;

export type ElementRegistry = { [key: HTMLElement["tagName"]]: StaticValue };

export type RootElement = HTMLElement | DocumentFragment;
