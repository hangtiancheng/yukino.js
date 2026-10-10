export type AntiCopyMode = "block" | "replace";

export type ViolationType =
  | "copy"
  | "cut"
  | "drag"
  | "selection"
  | "keyboard"
  | "contextmenu"
  | "print"
  | "devtools";

export interface ViolationEvent {
  type: ViolationType;
  originalEvent?: Event;
  key?: string;
}

export interface DevtoolsOptions {
  intervalMs?: number;
  threshold?: number;
  freeze?: boolean;
  redirectUrl?: string | false;
}

export interface AntiCopyOptions {
  mode?: AntiCopyMode;
  replaceText?: string | ((selection: string) => string);
  excludeSelectors?: string[];
  copy?: boolean;
  keyboard?: boolean;
  contextmenu?: boolean;
  selectStyle?: boolean;
  print?: boolean;
  devtools?: boolean | DevtoolsOptions;
  onViolation?: (event: ViolationEvent) => void;
  target?: Document;
}

export interface AntiCopyInstance {
  enable(): void;
  disable(): void;
  destroy(): void;
  isEnabled(): boolean;
  update(options: Partial<AntiCopyOptions>): void;
}

export interface Feature {
  attach(): void;
  detach(): void;
}

export interface ResolvedOptions {
  mode: AntiCopyMode;
  replaceText: string | ((selection: string) => string);
  excludeSelectors: string[];
  copy: boolean;
  keyboard: boolean;
  contextmenu: boolean;
  selectStyle: boolean;
  print: boolean;
  devtools: Required<DevtoolsOptions> | false;
  onViolation?: (event: ViolationEvent) => void;
  target: Document;
}
