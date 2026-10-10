export type Bundler = "vite" | "webpack";

function getComponentHmrSnippet(bundler: Bundler): string {
  if (bundler === "vite") {
    return `
// Auto-injected by yukinoReactSignalPlugin
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.oldComponent = __yukino_component__;
  });
  import.meta.hot.accept((newMod) => {
    const newComponent = newMod?.default;
    const oldComponent = import.meta.hot.data?.oldComponent;
    if (
      typeof oldComponent === "function" &&
      typeof newComponent === "function" &&
      oldComponent !== newComponent
    ) {
      const hmr = globalThis.__yukino_hmr__;
      if (hmr && hmr.hotSwapByComponent) hmr.hotSwapByComponent(oldComponent, newComponent);
    }
  });
}
`;
  }

  return `
// Auto-injected by yukinoReactSignalPlugin
if (import.meta.webpackHot) {
  const oldComponent = import.meta.webpackHot.data?.oldComponent;
  if (oldComponent) {
    const newComponent = __yukino_component__;
    if (
      typeof oldComponent === "function" &&
      typeof newComponent === "function" &&
      oldComponent !== newComponent
    ) {
      const hmr = globalThis.__yukino_hmr__;
      if (hmr && hmr.hotSwapByComponent) hmr.hotSwapByComponent(oldComponent, newComponent);
    }
  }
  import.meta.webpackHot.dispose((data) => {
    data.oldComponent = __yukino_component__;
  });
  import.meta.webpackHot.accept((err) => {
    if (err) {
      console.error(err);
      globalThis.location?.reload();
    }
  });
}
`;
}

const EXPORT_DEFAULT_REGEXP = /^[ \t]*export\s+default\s+/m;

const NAMED_DECLARATION_REGEXP =
  /^(?:(?:async\s+)?function(?:\s*\*)?|(?:abstract\s+)?class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

export function isYukinoComponentSource(source: string): boolean {
  return EXPORT_DEFAULT_REGEXP.test(source);
}

export function injectComponentHmrSnippet(
  source: string,
  bundler: Bundler,
): string {
  if (source.includes("__yukino_component__")) return source;

  const match = EXPORT_DEFAULT_REGEXP.exec(source);
  if (!match) return source;

  const bodyStart = match.index + match[0].length;
  const named = NAMED_DECLARATION_REGEXP.exec(source.slice(bodyStart));
  if (named) {
    return (
      source.slice(0, match.index) +
      source.slice(bodyStart) +
      `\nconst __yukino_component__ = ${named[1]};\nexport default __yukino_component__;\n` +
      getComponentHmrSnippet(bundler)
    );
  }

  return (
    source.slice(0, match.index) +
    "const __yukino_component__ = " +
    source.slice(bodyStart) +
    "\nexport default __yukino_component__;\n" +
    getComponentHmrSnippet(bundler)
  );
}
