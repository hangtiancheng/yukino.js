import { CustomElementClass, ClassDescriptor } from "../types";

const customElementRegistry = new Map<
  CustomElementClass | ClassDescriptor,
  string
>();

const onUnload = () => {
  window.removeEventListener("beforeunload", onUnload);
  customElementRegistry.clear();
};
window.addEventListener("beforeunload", onUnload);

export default customElementRegistry;
