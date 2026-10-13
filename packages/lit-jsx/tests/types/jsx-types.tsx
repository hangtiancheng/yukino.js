/**
 * Type-level regression tests for the JSX type layer. This file is never
 * executed — it is checked by `tsc -p tests/types/tsconfig.json` (part of
 * `pnpm typecheck`). `@ts-expect-error` lines assert that invalid usage
 * keeps failing to compile.
 */
import { LitElement } from "../../src/index";
import { property } from "../../src/decorators";

// ---------------------------------------------------------------------------
// B2: a custom element's own `onXxx` callback property must not be intersected
// with the native event-handler spelling into an uncallable function type.
// ---------------------------------------------------------------------------
class StudentForm extends LitElement {
  @property({ attribute: false })
  onSubmit?: (values: { name: string }) => void;
}

class DatePicker extends LitElement {
  @property({ attribute: false })
  value?: Date;
}

declare global {
  interface HTMLElementTagNameMap {
    "student-form": StudentForm;
    "date-picker": DatePicker;
  }
}

export const customCallbackProp = (
  <student-form onSubmit={(values) => console.log(values.name)} />
);

export const customCallbackPropNegative = (
  // @ts-expect-error -- the element's own onSubmit takes form values, not a SubmitEvent
  <student-form onSubmit={(e: SubmitEvent) => e.preventDefault()} />
);

// a custom element's richly-typed `value` property keeps its own type
export const customValueProp = <date-picker value={new Date()} />;

// native event spellings still work on primitives
export const nativeSubmit = <form onSubmit={(e) => e.preventDefault()} />;

// ---------------------------------------------------------------------------
// B3: React-style camelCase event names must be typed (they were implicit-any
// before, even though the runtime always supported them).
// ---------------------------------------------------------------------------
export const reactEventNames = (
  <input
    onKeyDown={(e) => e.key}
    onKeyUp={(e) => e.code}
    onKeyPress={(e) => e.repeat}
    onMouseDown={(e) => e.button}
    onMouseEnter={(e) => e.clientX}
    onDoubleClick={(e) => e.detail}
    onTransitionEnd={(e) => e.propertyName}
    onAnimationEnd={(e) => e.animationName}
    onTouchStart={(e) => e.touches.length}
    onPointerDown={(e) => e.pointerId}
    onContextMenu={(e) => e.clientY}
    onCompositionStart={(e) => e.data}
    onCanPlay={(e) => e.type}
    onTimeUpdate={(e) => e.type}
    onFocusIn={(e) => e.type}
    onBeforeToggle={(e) => e.type}
    onSlotChange={(e) => e.type}
  />
);

// the generated on${Capitalize<event>} spellings keep working
export const nativeEventNames = (
  <input
    onClick={(e) => e.clientX}
    onKeydown={(e) => e.key}
    onDblclick={(e) => e.detail}
    onInput={(e) => e.type}
  />
);

// @ts-expect-error -- KeyboardEvent has no `button`
export const wrongEventPayload = <input onKeyDown={(e) => e.button} />;

// @ts-expect-error -- MouseEvent has no `key`
export const wrongEventPayload2 = <div onClick={(e) => e.key} />;

// ---------------------------------------------------------------------------
// B5: `value`/`defaultValue` accept numbers like React's types do.
// ---------------------------------------------------------------------------
export const numericValues = (
  <>
    <input type="hidden" value={42} />
    <input defaultValue={42} />
    <textarea value={7} />
    <textarea defaultValue={7} />
    <select value={2}>
      <option value="2">Two</option>
    </select>
    <select defaultValue="b">
      <option value="b">B</option>
    </select>
    <option value={1}>One</option>
    <li value={5}>five</li>
    <li value="5">five</li>
    <meter value={0.5} />
    <input value={null} />
  </>
);

// @ts-expect-error -- objects are not valid input values
export const objectValue = <input value={{ a: 1 }} />;

// ---------------------------------------------------------------------------
// General prop-surface regressions
// ---------------------------------------------------------------------------
const Greeting = ({ name }: { name: string }) => <div>hi {name}</div>;

export const general = (
  <>
    <Greeting name="ada" />
    <div
      class="a"
      className="b"
      style={{ backgroundColor: "red" }}
      data-x="1"
      aria-label="l"
      key="k"
      ref={(el) => el?.className}
    >
      text {1} {null} {false}
    </div>
    <input disabled ref={(el) => el?.focus()} />
    <my-unregistered-thing anything={1} />
  </>
);
