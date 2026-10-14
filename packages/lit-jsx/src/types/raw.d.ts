/**
 * Vite-style `?raw` imports: `import text from "./file.svg?raw"` yields the
 * file contents as a string default export. Backed at build time by the
 * raw-import esbuild plugin in `tsup.config.ts`, in dev/tests by Vite's
 * native `?raw` support, and at type level by this declaration.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
