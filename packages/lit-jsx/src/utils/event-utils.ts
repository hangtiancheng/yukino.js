// Map JSX/React event names to their standard DOM counterpart.
//
// Almost every name follows the React convention `onFooBar` -> `foobar`, so a
// Proxy derives those on the fly and new DOM events (e.g. `scrollend`) work
// without touching this file. Only names that break the pattern are listed
// explicitly. The `on` + capital-letter guard keeps non-event props like
// `only` or `once` from being mistaken for event handlers.
const specialCases: Record<string, string> = {
  onDoubleClick: "dblclick",
};

const eventsMap = new Proxy<Record<string, string | undefined>>(specialCases, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    if (Object.hasOwn(target, prop)) return target[prop];
    return /^on[A-Z]/.test(prop) ? prop.slice(2).toLowerCase() : undefined;
  },
});

export function getNativeEventName(reactEventName: string): string | undefined {
  return eventsMap[reactEventName];
}
