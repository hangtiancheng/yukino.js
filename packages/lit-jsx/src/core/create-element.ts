import { ref } from "lit/directives/ref.js";
import { html, unsafeStatic } from "lit/static-html.js";
import type { StaticValue } from "lit/static-html.js";
import { styleMap } from "lit/directives/style-map.js";
import { spread } from "../directives/spread";
import { getHTMLTag, parseProps, parseChildren } from "../utils/element-utils";
import defaultElementRegistry from "./element-registry";
import { ElementRegistry } from "../types";

// Allow users to customize what should be rendered for each tag name.
// i.e if someone wants JSX <button /> to result in <my-custom-button /> they
// would pass an override in their registry.
let elementRegistry: ElementRegistry;
export function assignElements(overrides: {
  [tag: string]: string | StaticValue;
}) {
  // Plain strings must be marked as Lit static values before they can be used
  // in a template's tag-name position, otherwise Lit throws in dev mode and
  // renders a broken tag name in production builds.
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

// Avoid creating a new object each time the user doesn't provide a style prop.
const EMPTY_STYLES = {};

// lit-html cannot bind expressions inside textarea/template content (dev-mode
// warning for textarea, hard throw for template). JSX children of these tags
// are dropped; textarea content is controlled via the `value` prop instead.
const NO_CHILD_EXPRESSION_TAGS = new Set(["textarea", "template"]);

type ElementConfig = {
  children?: unknown;
  ref?: Parameters<typeof ref>[0];
  style?: Parameters<typeof styleMap>[0];
  // Accepted for React familiarity; Lit diffing has no key semantics, so it
  // must be stripped rather than leaked onto the element as a property.
  key?: unknown;
  [property: string]: unknown;
};

// Render an HTML template using the given type and props, forwarding children.
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
