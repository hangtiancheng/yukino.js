const isBrowser = !!(
  // typeof window !== 'undefined' &&
  // window.document &&
  // window.document.createElement

  (
    typeof window !== "undefined" &&
    typeof window.document !== "undefined" &&
    typeof window.navigator !== "undefined"
  )
);

export default isBrowser;
