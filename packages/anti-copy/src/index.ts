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
  return merged;
}

export function createAntiCopy(
  options: AntiCopyOptions = {},
): AntiCopyInstance {
  if (!isBrowser()) return NOOP_INSTANCE;

  let currentOptions = { ...options };
  let features = buildFeatures(currentOptions);
  let enabled = false;
  let destroyed = false;

  const instance: AntiCopyInstance = {
    enable() {
      if (destroyed || enabled) return;
      const attached: Feature[] = [];
      try {
        for (const feature of features) {
          attached.push(feature);
          feature.attach();
        }
      } catch (error) {
        for (const feature of attached) {
          try {
            feature.detach();
          } catch {}
        }
        throw error;
      }
      enabled = true;
    },
    disable() {
      if (!enabled) return;
      let firstError: unknown;
      for (const feature of features) {
        try {
          feature.detach();
        } catch (error) {
          firstError ??= error;
        }
      }
      enabled = false;
      if (firstError !== undefined) throw firstError;
    },
    destroy() {
      instance.disable();
      destroyed = true;
      features = [];
    },
    isEnabled: () => enabled,
    update(patch) {
      if (destroyed) return;
      const wasEnabled = enabled;
      instance.disable();
      currentOptions = mergeOptions(currentOptions, patch);
      features = buildFeatures(currentOptions);
      if (wasEnabled) instance.enable();
    },
  };

  return instance;
}
