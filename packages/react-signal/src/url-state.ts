/**
 * useUrlState — sync component state with URL search params.
 *
 * A REAL hook (component-only, uses a hook slot): returns `[value, setValue]`
 * (react `useState` / react-router `useSearchParams` shape). The value is
 * computed from a TRACKED read of the active router's `searchParams` — the
 * component re-renders when the URL changes (back/forward or `navigate`).
 * `setValue` is a STABLE function (created once per instance) that navigates
 * with the patched params, preserving the current pathname, hash, and
 * unrelated search params.
 */
import { untracked } from "./reactive";
import { useValueSlot } from "./component";
import { useRouter } from "./router";
import type { NavigateOptions, RouterApi } from "./types";

function readValues<S extends Record<string, string>>(
  params: URLSearchParams,
  defaults: S | undefined,
): S {
  const result: Record<string, string> = { ...(defaults ?? {}) };
  if (defaults) {
    for (const key of Object.keys(defaults)) {
      const val = params.get(key);
      if (val !== null && val !== "") result[key] = val;
    }
  } else {
    params.forEach((val, key) => {
      result[key] = val;
    });
  }
  // result is dynamically constructed from defaults + URL params;
  // cast to S is unavoidable since we can't verify the shape at runtime.
  return result as S;
}

type SetUrlState<S extends Record<string, string>> = (
  patch: Partial<S> | ((prev: S) => Partial<S>),
  options?: NavigateOptions,
) => void;

function createSetter<S extends Record<string, string>>(
  router: RouterApi,
  defaults: S | undefined,
): SetUrlState<S> {
  return (patch, options) => {
    const current = untracked(() => router.searchParams.value);
    const resolved =
      typeof patch === "function"
        ? patch(readValues(current, defaults))
        : patch;
    const next = new URLSearchParams(current);
    for (const key of Object.keys(resolved)) {
      const val = resolved[key];
      if (val == null) next.delete(key);
      else next.set(key, String(val));
    }
    const search = next.toString();
    const loc = router.location.peek();
    void router.navigate(
      {
        pathname: loc.pathname,
        search: search ? `?${search}` : "",
        hash: loc.hash,
      },
      options,
    );
  };
}

/**
 * Sync component state with URL search params (active router).
 *
 * @param defaults - Default values for each URL param key. Keys not present
 *   in the URL use these defaults; keys present in the URL override. Omit to
 *   read every current search param. Captured on the FIRST render.
 * @returns `[value, setValue]`:
 *   - `value`: current params merged over defaults (a tracked read — fresh
 *     every render)
 *   - `setValue(patch | updater, { replace? })`: STABLE across renders;
 *     navigates with the patched params. Only the specified keys change;
 *     `undefined`/`null` deletes a key; other search params, pathname, and
 *     hash are preserved.
 *
 * @example
 * ```tsx
 * export default function Pager() {
 *   const [params, setParams] = useUrlState({ page: "1", size: "20" });
 *   return (
 *     <button onClick={() => setParams((p) => ({ page: String(Number(p.page) + 1) }))}>
 *       Page {params.page}
 *     </button>
 *   );
 * }
 * ```
 */
export function useUrlState<S extends Record<string, string>>(
  defaults?: S,
): [Readonly<S>, SetUrlState<S>] {
  const router = useRouter();
  // Stable setter: one slot per instance (defaults + router captured on the
  // first render — rules of hooks).
  const setValue = useValueSlot(() => createSetter<S>(router, defaults));
  const value = readValues(router.searchParams.value, defaults); // tracked
  return [value, setValue];
}
