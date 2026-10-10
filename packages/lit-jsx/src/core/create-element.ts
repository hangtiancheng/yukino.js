import { ref } from "lit/directives/ref.js";
import { html, unsafeStatic } from "lit/static-html.js";
import type { StaticValue } from "lit/static-html.js";
import { styleMap } from "lit/directives/style-map.js";
import { spread } from "../directives/spread";
import { getHTMLTag, parseProps, parseChildren } from "../utils/element-utils";
import defaultElementRegistry from "./element-registry";
import { ElementRegistry } from "../types";

let elementRegistry: ElementRegistry;
export function assignElements(overrides: {
  [tag: string]: string | StaticValue;
}) {
  Object.assign(
    elementRegistry,
    Object.fromEntries(
      Object.entries(overrides).map(([tag, value]) => [
        tag,
        typeof value === "string" ? unsafeStatic(value) : value,
      ]),
    ),
  );
}
export function resetElements() {
  elementRegistry = Object.assign({}, defaultElementRegistry);
}
resetElements();

const EMPTY_STYLES = {};

const NO_CHILD_EXPRESSION_TAGS = new Set(["textarea", "template"]);

type ElementConfig = {
  children?: unknown;
  ref?: Parameters<typeof ref>[0];
  style?: Parameters<typeof styleMap>[0];
  key?: unknown;
  [property: string]: unknown;
};

export default function createElement(
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  { children, ref: elementRef, style, key, ...props }: ElementConfig = {},
) {
  const tagName = getHTMLTag(type, elementRegistry);
  if (NO_CHILD_EXPRESSION_TAGS.has(tagName._$litStatic$)) {
    return html`<${tagName} ${ref(elementRef)} ${spread(parseProps(type, props, elementRegistry))} style=${styleMap(style ?? EMPTY_STYLES)}></${tagName}>`;
  }
  return html`<${tagName} ${ref(elementRef)} ${spread(parseProps(type, props, elementRegistry))} style=${styleMap(style ?? EMPTY_STYLES)}>${parseChildren(children, elementRegistry)}</${tagName}>`;
}
