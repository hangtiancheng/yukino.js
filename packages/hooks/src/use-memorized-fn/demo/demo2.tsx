import { useState } from "react";
import { useMemorizedFn } from "../index.js";

export default () => {
  const [count, setCount] = useState(0);

  const memorizedFn1 = useMemorizedFn(() => {
    console.log(1);

    setCount((prev) => {
      console.log(2);
      return prev + 1;
    });
  });

  const memorizedFn2 = useMemorizedFn(() => {
    console.log(3, count);
    setCount(count + 1);
  });

  return (
    <>
      <button type="button" className="btn" onClick={memorizedFn1}>
        Add count {count}
      </button>
      <button type="button" className="btn" onClick={memorizedFn2}>
        Add count {count}
      </button>
    </>
  );
};
