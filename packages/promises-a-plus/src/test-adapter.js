import MyPromise from "./my-promise.js";

const adapter = {
  resolved: (value) => MyPromise.resolve(value),
  rejected: (reason) => MyPromise.reject(reason),
  deferred: () => {
    let resolve;
    let reject;
    const promise = new MyPromise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    if (resolve === undefined || reject === undefined) {
      throw new Error(
        "Deferred promise must have resolve and reject functions",
      );
    }
    return {
      promise,
      resolve,
      reject,
    };
  },
};

export default adapter;
