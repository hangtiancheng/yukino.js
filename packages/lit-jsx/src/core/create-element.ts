import { ref } from "lit/directives/ref.js";
import { html, unsafeStatic } from "lit/static-html.js";
import type { StaticValue } from "lit/static-html.js";
import { styleMap } from "lit/directives/style-map.js";
import { spread } from "../directives/spread";
import { selectValue } from "../directives/select-value";
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
  const resolvedTag = tagName._$litStatic$;
  if (resolvedTag === "select") {
    // `value`/`defaultValue` are applied by `selectValue` *after* the option
    // children commit — assigning them via `spread` in the opening tag would
    // run before any option exists and silently select nothing.
    const { value, defaultValue, ...selectProps } = props;
    return html`<${tagName} ${ref(elementRef)} ${spread(parseProps(type, selectProps, elementRegistry))} style=${styleMap(style ?? EMPTY_STYLES)}>${parseChildren(children, elementRegistry)}${selectValue(value, defaultValue)}</${tagName}>`;
  }
  if (NO_CHILD_EXPRESSION_TAGS.has(resolvedTag)) {
    const textareaProps =
      resolvedTag === "textarea"
        ? withTextChildrenAsValue(children, props)
        : props;
    return html`<${tagName} ${ref(elementRef)} ${spread(parseProps(type, textareaProps, elementRegistry))} style=${styleMap(style ?? EMPTY_STYLES)}></${tagName}>`;
  }
  return html`<${tagName} ${ref(elementRef)} ${spread(parseProps(type, props, elementRegistry))} style=${styleMap(style ?? EMPTY_STYLES)}>${parseChildren(children, elementRegistry)}</${tagName}>`;
}

/**
 * React treats a `<textarea>`'s text children as its initial value. lit-html
 * cannot render child expressions inside `<textarea>` (the HTML parser treats
 * everything there as raw text), so text children are forwarded through the
 * `defaultValue` property instead, preserving user edits and form reset.
 * Explicit `value`/`defaultValue` props win.
 */
function withTextChildrenAsValue(
  children: unknown,
  props: Record<string, unknown>,
) {
  if (props.value != null || props.defaultValue != null) return props;
  const text = childrenAsText(children);
  return text === undefined ? props : { ...props, defaultValue: text };
}

function childrenAsText(children: unknown): string | undefined {
  const childList = Array.isArray(children) ? children : [children];
  let text: string | undefined;
  for (const child of childList) {
    if (child == null || typeof child === "boolean") continue;
    if (typeof child !== "string" && typeof child !== "number") {
      return undefined;
    }
    text = text === undefined ? String(child) : text + String(child);
  }
  return text;
}
