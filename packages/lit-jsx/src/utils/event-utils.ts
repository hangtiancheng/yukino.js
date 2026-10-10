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
