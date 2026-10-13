import { nothing } from "lit/html.js";
import { directive, Directive } from "lit/directive.js";
import type { ChildPart } from "lit";

/**
 * Applies `value` / `defaultValue` to a `<select>` element *after* its
 * `<option>` children have been committed.
 *
 * lit-html commits a template's parts in document order, and JSX props are
 * applied by the `spread` directive bound in the opening tag — which runs
 * before the children part. Setting `.value` on a `<select>` whose options do
 * not exist yet is silently ignored, and once the options render the browser
 * falls back to selecting the first one. `createElement` therefore hoists
 * select value props out of the spread data and renders this directive as a
 * child part placed after the options.
 *
 * Semantics (aligned with React):
 * - `value` is re-applied on every render (controlled select).
 * - `defaultValue` is applied when it first appears or changes, but is not
 *   re-applied on unrelated re-renders, so a user's selection survives them
 *   (uncontrolled select).
 * - Array values select every matching option (`multiple` selects).
 */
class SelectValueDirective extends Directive {
  appliedDefaultValue: unknown;

  render(_value?: unknown, _defaultValue?: unknown) {
    return nothing;
  }

  update(part: ChildPart, [value, defaultValue]: Parameters<this["render"]>) {
    const select = part.parentNode;
    if (!select) return nothing;
    if (value != null) {
      applySelectValue(select as HTMLSelectElement, value);
    } else if (
      defaultValue != null &&
      defaultValue !== this.appliedDefaultValue
    ) {
      this.appliedDefaultValue = defaultValue;
      applySelectValue(select as HTMLSelectElement, defaultValue);
    }
    return nothing;
  }
}

function applySelectValue(select: HTMLSelectElement, value: unknown) {
  if (Array.isArray(value)) {
    const values = new Set(value.map((item) => String(item)));
    for (const option of Array.from(select.options)) {
      option.selected = values.has(option.value);
    }
    return;
  }
  select.value = String(value);
}

export const selectValue = directive(SelectValueDirective);
