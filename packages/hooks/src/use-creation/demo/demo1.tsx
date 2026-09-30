import { useState } from "react";
import useCreation from "../index.js";

class Foo {
  constructor(public data = Math.random()) {}
}

export default () => {
  const foo = useCreation(() => new Foo(), []);

  const [, setFlag] = useState({});

  return (
    <>
      <p className="alert">{foo.data}</p>
      <p className="alert">{Math.random()}</p>
      <button type="button" className="btn" onClick={() => setFlag({})}>
        rerender
      </button>
    </>
  );
};
