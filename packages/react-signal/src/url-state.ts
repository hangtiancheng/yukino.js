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

export function useUrlState<S extends Record<string, string>>(
  defaults?: S,
): [Readonly<S>, SetUrlState<S>] {
  const router = useRouter();
  const setValue = useValueSlot(() => createSetter<S>(router, defaults));
  const value = readValues(router.searchParams.value, defaults);
  return [value, setValue];
}
