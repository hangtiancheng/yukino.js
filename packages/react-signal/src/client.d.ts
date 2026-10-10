declare var __yukino_hmr__: {
  hotSwapByComponent: (oldFn: unknown, newFn: unknown) => boolean;
};

interface ImportMeta {
  webpackHot?: {
    accept(errorHandler?: (err: unknown) => void): void;
    dispose(cb: (data: Record<string, unknown>) => void): void;
    data?: Record<string, unknown>;
  };
}
