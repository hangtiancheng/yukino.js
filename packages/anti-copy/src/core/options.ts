import type { AntiCopyOptions, ResolvedOptions } from "./types";

export const DEFAULT_REPLACE_TEXT = "Copying is not allowed on this page.";

const DEFAULT_DEVTOOLS_INTERVAL_MS = 1000;
const DEFAULT_DEVTOOLS_THRESHOLD = 170;
const DEFAULT_DEVTOOLS_REDIRECT_URL = "about:blank";

function resolveDevtools(
  options: AntiCopyOptions,
): ResolvedOptions["devtools"] {
  if (!options.devtools) return false;
  const config = options.devtools === true ? {} : options.devtools;
  return {
    intervalMs: config.intervalMs ?? DEFAULT_DEVTOOLS_INTERVAL_MS,
    threshold: config.threshold ?? DEFAULT_DEVTOOLS_THRESHOLD,
    freeze: config.freeze ?? true,
    redirectUrl: config.redirectUrl ?? DEFAULT_DEVTOOLS_REDIRECT_URL,
  };
}

/** Merge user options with defaults into a fully-populated config object. */
export function resolveOptions(options: AntiCopyOptions = {}): ResolvedOptions {
  return {
    mode: options.mode ?? "block",
    replaceText: options.replaceText ?? DEFAULT_REPLACE_TEXT,
    excludeSelectors: options.excludeSelectors ?? [],
    copy: options.copy ?? true,
    keyboard: options.keyboard ?? true,
    contextmenu: options.contextmenu ?? true,
    // "replace" mode needs a live selection for the copy event to substitute,
    // so selection blocking defaults off there.
    selectStyle: options.selectStyle ?? options.mode !== "replace",
    print: options.print ?? true,
    devtools: resolveDevtools(options),
    onViolation: options.onViolation,
    target: options.target ?? document,
  };
}
