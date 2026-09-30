// https://ahooks.js.org/hooks/use-url-state/

import { useMemoizedFn, useUpdate } from "../index.js";
import type { ParseOptions, StringifyOptions } from "query-string";
import queryString from "query-string";
import { type SetStateAction, useMemo, useRef } from "react";
import { useHistory } from "react-router-v5";
import { useNavigate, useLocation } from "react-router";

interface Options {
  navigateMode?: "push" | "replace";
  parseOptions?: ParseOptions;
  stringifyOptions?: StringifyOptions;
  version?: "v5" | "latest";
}

interface ISetStateOptions {
  clearState?: boolean;
}

const baseParseConfig: ParseOptions = {
  parseNumbers: false,
  parseBooleans: false,
};

const baseStringifyConfig: StringifyOptions = {
  skipNull: false,
  skipEmptyString: false,
};

type UrlState = Record<string, unknown>;

const useUrlState = <S extends UrlState = UrlState>(
  initialState?: S | (() => S),
  options?: Options,
) => {
  type State = Partial<{ [key in keyof S]: unknown }>;

  const {
    navigateMode = "push",
    parseOptions,
    stringifyOptions,
    version = "latest",
  } = options ?? {};

  const mergedParseOptions = { ...baseParseConfig, ...parseOptions };
  const mergedStringifyOptions = {
    ...baseStringifyConfig,
    ...stringifyOptions,
  };

  const location = useLocation();
  // react-router v5
  const history = useHistory();
  // react-router latest
  const navigate = useNavigate();

  const update = useUpdate();

  const initialStateRef = useRef(
    typeof initialState === "function"
      ? (initialState as () => S)()
      : (initialState ?? {}),
  );

  const queryFromUrl = useMemo(
    () => queryString.parse(location.search, mergedParseOptions),
    [location.search],
  );

  const targetQuery: State = useMemo(
    () => ({
      ...initialStateRef.current,
      ...queryFromUrl,
    }),
    [queryFromUrl],
  );

  const setState = (s: SetStateAction<State>, options?: ISetStateOptions) => {
    const newQuery = typeof s === "function" ? s(targetQuery) : s;
    const { clearState = false } = options ?? {};
    const queryObject = clearState
      ? { ...newQuery }
      : { ...queryFromUrl, ...newQuery };

    // update 和 history 的更新会被合并, 不会导致多次渲染
    // React 自动批处理: 在同一个同步任务中调度的多个状态更新会被合并为一次渲染
    update();
    if (version === "v5") {
      history[navigateMode](
        {
          hash: location.hash,
          search:
            queryString.stringify(queryObject, mergedStringifyOptions) || "?",
        },
        location.state,
      );
    }
    if (version === "latest") {
      navigate(
        {
          hash: location.hash,
          search:
            queryString.stringify(queryObject, mergedStringifyOptions) || "?",
        },
        {
          replace: navigateMode === "replace",
          state: location.state,
        },
      );
    }
  };

  return [targetQuery, useMemoizedFn(setState)] as const;
};

export default useUrlState;
