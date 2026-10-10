import { injectComponentHmrSnippet } from "./hmr-inject";

declare const __filename: string;

export interface ReactWebpackPluginOptions {
  test?: RegExp;
  exclude?: RegExp;
}

function reactLoader(this: unknown, source: string): string {
  if ((this as { mode?: string } | null | undefined)?.mode === "production") {
    return source;
  }
  try {
    return injectComponentHmrSnippet(source, "webpack");
  } catch (err) {
    console.error(err);
    return source;
  }
}

class ReactPlugin {
  private options: ReactWebpackPluginOptions;

  constructor(options: ReactWebpackPluginOptions = {}) {
    this.options = {
      test: /\.[jt]sx$/,
      exclude: /node_modules/,
      ...options,
    };
  }

  apply(compiler: {
    options: {
      mode?: unknown;
      module: {
        rules: unknown[];
      };
    };
  }): void {
    if (compiler.options.mode === "production") {
      return;
    }

    const { test, exclude } = this.options;

    compiler.options.module = compiler.options.module || {};
    compiler.options.module.rules = compiler.options.module.rules || [];

    compiler.options.module.rules.push({
      test,
      exclude,
      enforce: "pre",
      use: [
        {
          loader: __filename.endsWith(".js")
            ? __filename.slice(0, -3) + ".cjs"
            : __filename,
        },
      ],
    });
  }
}

export { reactLoader, ReactPlugin };
export { reactLoader as default };
