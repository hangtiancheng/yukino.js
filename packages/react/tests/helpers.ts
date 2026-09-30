/**
 * setState marks the root dirty and re-renders in a queueMicrotask. Awaiting
 * one resolved promise queues the continuation AFTER that flush (microtasks
 * are FIFO), so `await flush()` observes the committed DOM. Cascading updates
 * (an effect calling setState) need one await per wave.
 */
export function flush(): Promise<void> {
  return Promise.resolve();
}

export function createContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

export function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
