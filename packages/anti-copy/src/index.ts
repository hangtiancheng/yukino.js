import { createClipboardFeature } from "./core/clipboard";
import { createContextmenuFeature } from "./core/contextmenu";
import { createDevtoolsFeature } from "./core/devtools";
import { createKeyboardFeature } from "./core/keyboard";
import { resolveOptions } from "./core/options";
import { createPrintFeature } from "./core/print";
import { createStyleFeature } from "./core/style";
import type {
  AntiCopyInstance,
  AntiCopyMode,
  AntiCopyOptions,
  DevtoolsOptions,
  Feature,
  ViolationEvent,
  ViolationType,
} from "./core/types";
import { isBrowser } from "./core/utils";

export type {
  AntiCopyInstance,
  AntiCopyMode,
  AntiCopyOptions,
  DevtoolsOptions,
  ViolationEvent,
  ViolationType,
};
export { DEFAULT_REPLACE_TEXT } from "./core/options";
export { isBrowser } from "./core/utils";

const NOOP_INSTANCE: AntiCopyInstance = {
  enable() {},
  disable() {},
  destroy() {},
  isEnabled: () => false,
  update() {},
};

function buildFeatures(options: AntiCopyOptions): Feature[] {
  const resolved = resolveOptions(options);
  const features: Feature[] = [];
  if (resolved.selectStyle) features.push(createStyleFeature(resolved));
  if (resolved.copy) features.push(createClipboardFeature(resolved));
  if (resolved.keyboard) features.push(createKeyboardFeature(resolved));
  if (resolved.contextmenu) features.push(createContextmenuFeature(resolved));
  if (resolved.print) features.push(createPrintFeature(resolved));
  if (resolved.devtools) features.push(createDevtoolsFeature(resolved));
  return features;
}

function mergeOptions(
  current: AntiCopyOptions,
  patch: Partial<AntiCopyOptions>,
): AntiCopyOptions {
  const merged: AntiCopyOptions = { ...current, ...patch };
  if (
    typeof current.devtools === "object" &&
    typeof patch.devtools === "object"
  ) {
    merged.devtools = { ...current.devtools, ...patch.devtools };
  }
  if (merged.excludeSelectors) {
    merged.excludeSelectors = [...merged.excludeSelectors];
  }
  if (typeof merged.devtools === "object") {
    merged.devtools = { ...merged.devtools };
  }
  return merged;
}

export function createAntiCopy(
  options: AntiCopyOptions = {},
): AntiCopyInstance {
  if (!isBrowser()) return NOOP_INSTANCE;

  let currentOptions = mergeOptions({}, options);
  let features = buildFeatures(currentOptions);
  let attached: Feature[] = [];
  let enabled = false;
  let destroyed = false;

  const instance: AntiCopyInstance = {
    enable() {
      if (destroyed || enabled) return;
      // Retry any cleanup left behind by an earlier failed transition.
      instance.disable();
      try {
        for (const feature of features) {
          attached.push(feature);
          feature.attach();
        }
      } catch (error) {
        try {
          instance.disable();
        } catch {}
        throw error;
      }
      enabled = true;
    },
    disable() {
      enabled = false;
      if (attached.length === 0) return;
      const pending = attached;
      attached = [];
      let firstError: unknown;
      let failed = false;
      for (const feature of pending) {
        try {
          feature.detach();
        } catch (error) {
          attached.push(feature);
          if (!failed) firstError = error;
          failed = true;
        }
      }
      if (failed) throw firstError;
    },
    destroy() {
      instance.disable();
      destroyed = true;
      features = [];
    },
    isEnabled: () => enabled,
    update(patch) {
      if (destroyed) return;
      const nextOptions = mergeOptions(currentOptions, patch);
      const nextFeatures = buildFeatures(nextOptions);
      const wasEnabled = enabled;
      instance.disable();
      const previousOptions = currentOptions;
      const previousFeatures = features;
      currentOptions = nextOptions;
      features = nextFeatures;
      try {
        if (wasEnabled) instance.enable();
      } catch (error) {
        currentOptions = previousOptions;
        features = previousFeatures;
        // Preserve the update error even if restoring the old target also fails.
        try {
          instance.enable();
        } catch {}
        throw error;
      }
    },
  };

  return instance;
}
