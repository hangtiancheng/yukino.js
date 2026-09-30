import { useState, useEffect } from "react";
import useLatest from "../index.js";

export default () => {
  const [count, setCount] = useState(0);
  const [count2, setCount2] = useState(0);
  const [count3, setCount3] = useState(0);

  const latestCountRef = useLatest(count);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(latestCountRef.current + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount2(count2 + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount3((count3) => count3 + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <p className="alert">count (useLatest): {count}</p>
      <p className="alert">count2: {count2}</p>
      <p className="alert">count3: {count3}</p>
    </>
  );
};
