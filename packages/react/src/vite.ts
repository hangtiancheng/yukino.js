import type { Plugin, UserConfig } from "vite";

import { injectComponentHmrSnippet as injectShared } from "./hmr-inject";

const COMPONENT_MODULE_ID_REGEXP = /\.[jt]sx$/;

export function injectComponentHmrSnippet(source: string): string {
  return injectShared(source, "vite");
}

export function reactPlugin(): Plugin {
  let isBuild = false;
  return {
    name: "yukino-react",
    enforce: "pre",

    config(userConfig): UserConfig | undefined {
      const esbuild = userConfig.esbuild;
      if (esbuild === false) return undefined;
      if (esbuild?.jsx === "preserve") return undefined;
      const patch: { jsx?: "automatic"; jsxImportSource?: string } = {};
      if (!esbuild?.jsx) patch.jsx = "automatic";
      if (!esbuild?.jsxImportSource) patch.jsxImportSource = "@yukino.js/react";
      if (Object.keys(patch).length === 0) return undefined;
      return { esbuild: patch };
    },

    configResolved(config): void {
      isBuild = config.command === "build";
    },

    transform(code, id) {
      if (isBuild) return undefined;
      if (!COMPONENT_MODULE_ID_REGEXP.test(id.split("?")[0])) return undefined;
      if (id.includes("node_modules")) return undefined;
      const transformed = injectComponentHmrSnippet(code);
      if (transformed === code) return undefined;
      return { code: transformed, map: null };
    },
  };
}

export default reactPlugin;
