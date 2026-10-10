export function hasOwnProperty<T extends object>(
  owner: T | undefined | null,
  prop: PropertyKey,
): boolean {
  return owner != null && Object.prototype.hasOwnProperty.call(owner, prop);
}

const warnedMessages = new Set<string>();

export function devWarn(message: string): void {
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);
  // eslint-disable-next-line no-console
  console.warn(`[yukino-react-signal] ${message}`);
}
