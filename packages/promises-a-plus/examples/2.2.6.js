// @ts-check
// 2.2.6 一个 promise 的 then 方法可以多次调用

const promise = new Promise((resolve) => {
  console.log("promise is pending");
  setTimeout(() => {
    resolve("promise is fulfilled");
  }, 3000);
});

promise.then((value) => {
  console.log("first .then() callback:", value);
});

promise.then((value) => {
  console.log("second .then() callback:", value);
});

promise.then((value) => {
  console.log("third .then() callback:", value);
});

setTimeout(() => {
  console.log("after 2s");
  promise.then((value) => {
    console.log("fourth .then() callback:", value);
    return "fourth then";
  });
}, 5000);
