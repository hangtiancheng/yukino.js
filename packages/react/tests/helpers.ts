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
