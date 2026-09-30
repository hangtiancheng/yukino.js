import { nothing } from "lit/html.js";
import { directive, AsyncDirective } from "lit/async-directive.js";
import type { AttributePart } from "lit";

type EventListenerWithOptions = EventListenerOrEventListenerObject &
  Partial<AddEventListenerOptions>;

class SpreadDirective extends AsyncDirective {
  host!: EventTarget;
  element!: Element;
  prevData: { [key: string]: unknown } = {};

  render(spreadData: { [key: string]: unknown }) {
    void spreadData;
    return nothing;
  }

  // Each update, apply the props and remove/clean up stale ones.
  // This directive only ever sits in an attribute position, so the part is
  // always an AttributePart.
  update(part: AttributePart, [spreadData]: Parameters<this["render"]>) {
    if (this.element !== part.element) {
      this.element = part.element;
    }
    this.host = (part.options?.host as EventTarget | undefined) || this.element;
    this.apply(spreadData);
    this.groom(spreadData);
    this.prevData = spreadData;
  }

  // Apply props.
  apply(data: { [key: string]: unknown }) {
    if (!data) return;
    const { prevData, element } = this;
    for (const key in data) {
      const value = data[key];
      if (value == null || value === prevData[key]) continue;
      const name = key.slice(1);
      switch (key[0]) {
        case "@": {
          const prevHandler = prevData[key];
          if (prevHandler) {
            element.removeEventListener(
              name,
              this,
              prevHandler as EventListenerWithOptions,
            );
          }
          element.addEventListener(
            name,
            this,
            value as EventListenerWithOptions,
          );
          break;
        }
        case ".": // property
          (element as unknown as Record<string, unknown>)[name] = value;
          break;
        case "?": // boolean attribute
          if (value) {
            element.setAttribute(name, "");
          } else {
            element.removeAttribute(name);
          }
          break;
        default: // standard attribute
          element.setAttribute(key, String(value));
          break;
      }
    }
  }

  // Clean up any removed props.
  groom(data: { [key: string]: unknown }) {
    const { prevData, element } = this;
    if (!prevData) return;
    for (const key in prevData) {
      const value = prevData[key];
      const removed =
        value != null && (!data || !(key in data) || data[key] == null);
      if (!removed) continue;
      switch (key[0]) {
        case "@":
          element.removeEventListener(
            key.slice(1),
            this,
            value as EventListenerWithOptions,
          );
          break;
        case ".": {
          // Reset removed property props; lit-html reuses the DOM node when
          // two renders share a template, so stale values would otherwise
          // leak onto the element that takes the node's place.
          const name = key.slice(1);
          if (Object.prototype.hasOwnProperty.call(element, name)) {
            // Expando property set by a previous apply — remove it entirely.
            delete (element as unknown as Record<string, unknown>)[name];
          } else if (name === "className") {
            // className reflects the class attribute; removing the attribute
            // resets the property to "" without leaving class="" behind.
            element.removeAttribute("class");
          } else {
            // Prototype accessor (IDL attribute or reactive property).
            // DOMString IDL attributes coerce `undefined` to the literal
            // string "undefined", so clear string-valued ones to "".
            const record = element as unknown as Record<string, unknown>;
            record[name] = typeof record[name] === "string" ? "" : undefined;
          }
          break;
        }
        case "?":
          element.removeAttribute(key.slice(1));
          break;
        default:
          element.removeAttribute(key);
          break;
      }
    }
  }

  handleEvent(event: Event) {
    const value = this.prevData[`@${event.type}`] as EventListenerWithOptions;
    if (typeof value === "function") {
      value.call(this.host, event);
    } else {
      value.handleEvent(event);
    }
  }

  disconnected() {
    const { prevData, element } = this;
    for (const key in prevData) {
      const value = prevData[key];
      if (key[0] !== "@" || value == null) continue;
      element.removeEventListener(
        key.slice(1),
        this,
        value as EventListenerWithOptions,
      );
    }
  }

  reconnected() {
    const { prevData, element } = this;
    for (const key in prevData) {
      const value = prevData[key];
      if (key[0] !== "@" || value == null) continue;
      element.addEventListener(
        key.slice(1),
        this,
        value as EventListenerWithOptions,
      );
    }
  }
}

export const spread = directive(SpreadDirective);
