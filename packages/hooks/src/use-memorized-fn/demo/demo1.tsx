import { useState } from "react";
import { usePersistFn } from "../index.js";

export default () => {
  const [count, setCount] = useState(0);

  const persistFn1 = usePersistFn(() => {
    console.log(1);

    setCount((prev) => {
      console.log(2);
      return prev + 1;
    });
  });

  const persistFn2 = usePersistFn(() => {
    console.log(3, count);
    setCount(count + 1);
  });

  return (
    <>
      <button type="button" className="btn" onClick={persistFn1}>
        Add count {count}
      </button>
      <button type="button" className="btn" onClick={persistFn2}>
        Add count {count}
      </button>
    </>
  );
};
