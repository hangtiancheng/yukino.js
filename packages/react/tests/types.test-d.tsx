import type { Ref, VNode } from "@yukino.js/react";

export function TypeChecks(): VNode {
  const objRef: { current: HTMLButtonElement | null } = { current: null };
  const fnRef: Ref<HTMLInputElement> = (el) => {
    void el;
    return () => {};
  };
  return (
    <div className="wrap" style={{ width: 100, opacity: 0.5 }}>
      <button
        type="submit"
        ref={objRef}
        onClick={(event) => {
          const native: MouseEvent = event;
          const target: EventTarget & HTMLButtonElement = event.currentTarget;
          void native;
          void target;
        }}
      >
        ok
      </button>
      <input
        value="v"
        ref={fnRef}
        onChange={(event) => {
          const native: Event = event;
          void native;
        }}
      />
      <svg viewBox="0 0 1 1">
        <path d="M0 0" />
      </svg>
      <div aria-hidden="true" data-anything="allowed" />
    </div>
  );
}

function Needs(props: { must: string }): VNode {
  return <div>{props.must}</div>;
}

export function TypeErrors(): void {
  // @ts-expect-error unknown intrinsic prop rejected by @types/react-derived map
  void (<div frobnicate="x" />);

  // @ts-expect-error unknown lowercase tag is not in IntrinsicElements
  void (<notarealtag />);

  // @ts-expect-error ref target type must match the tag's element type
  void (<div ref={{ current: 0 }} />);

  // @ts-expect-error missing required component prop
  void (<Needs />);

  void (<Needs must="yes" key="k" />);
}
