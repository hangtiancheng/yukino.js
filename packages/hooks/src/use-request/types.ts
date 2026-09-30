export type Service<TData, TParams extends any[]> = (
  ...args: TParams
) => Promise<TData>;

export type Subscribe = () => void;
