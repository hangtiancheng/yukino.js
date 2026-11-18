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
  // Browsers turn overflowing/invalid timer delays into a hot loop.
  const intervalMs = config.intervalMs ?? DEFAULT_DEVTOOLS_INTERVAL_MS;
  const threshold = config.threshold ?? DEFAULT_DEVTOOLS_THRESHOLD;
  return {
    intervalMs:
      Number.isFinite(intervalMs) &&
      intervalMs >= 1 &&
      intervalMs <= 2_147_483_647
        ? intervalMs
        : DEFAULT_DEVTOOLS_INTERVAL_MS,
    threshold:
      Number.isFinite(threshold) && threshold >= 0
        ? threshold
        : DEFAULT_DEVTOOLS_THRESHOLD,
    freeze: config.freeze ?? true,
    redirectUrl: config.redirectUrl ?? DEFAULT_DEVTOOLS_REDIRECT_URL,
  };
}

export function resolveOptions(options: AntiCopyOptions = {}): ResolvedOptions {
  return {
    mode: options.mode ?? "block",
    replaceText: options.replaceText ?? DEFAULT_REPLACE_TEXT,
    excludeSelectors: options.excludeSelectors ?? [],
    copy: options.copy ?? true,
    keyboard: options.keyboard ?? true,
    contextmenu: options.contextmenu ?? true,
    selectStyle: options.selectStyle ?? options.mode !== "replace",
    print: options.print ?? true,
    devtools: resolveDevtools(options),
    onViolation: options.onViolation,
    target: options.target ?? document,
  };
}
