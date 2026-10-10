const isBrowser = !!(
  typeof window !== "undefined" &&
  typeof window.document !== "undefined" &&
  typeof window.navigator !== "undefined"
);

export default isBrowser;
