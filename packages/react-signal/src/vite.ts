import type { Plugin } from "vite";
import {
  injectComponentHmrSnippet,
  isYukinoComponentSource,
} from "./hmr-inject";

const COMPONENT_MODULE_ID_REGEXP = /\.[jt]sx$/;

export function yukinoReactSignalPlugin(): Plugin {
  let isBuild = false;
  return {
    name: "yukino-react-signal",
    enforce: "pre",

    configResolved(config): void {
      isBuild = config.command === "build";
    },

    transform(code, id) {
      if (isBuild) return undefined;
      if (!COMPONENT_MODULE_ID_REGEXP.test(id.split("?")[0])) return undefined;
      if (id.includes("node_modules")) return undefined;
      if (!isYukinoComponentSource(code)) return undefined;
      const transformed = injectComponentHmrSnippet(code, "vite");
      if (transformed === code) return undefined;
      return { code: transformed, map: null };
    },
  };
}

export default yukinoReactSignalPlugin;
