import { useState } from "react";
import { useMemoizedFn } from "../index.js";

const useUpdate = () => {
  const [, setState] = useState({});

  return useMemoizedFn(() => setState({}));
};

export default useUpdate;
