# Promise A+

## 规范

- 1.1 "promise" 有 then 方法的对象或函数, 行为符合本规范
- 1.2 "thenable" 有 then 方法的对象或函数
- 1.3 "value" 合法的 JS 值 (包括 undefined、thenable 或 promise)
- 1.4 "exception" 使用 throw 语句抛出的值
- 1.5 "reason" 代表 promise 被拒绝的原因

- 2.1 promise 的三个状态: pending、fulfilled 或 rejected
  - 2.1.1 pending 时
    - 2.1.1.1 promise 可以转换为 fulfilled 或 rejected
  - 2.1.2 fulfilled 时
    - 2.1.2.1 promise 不能转换为其他状态
    - 2.1.2.2 必须有一个 value, 且 value 不能改变 (不能改变即 ===, 值类型是值不可变, 引用类型是引用不可变)
  - 2.1.3 rejected 时
    - 2.1.3.1 promise 不能转换为其他状态
    - 2.1.3.2 必须有一个 reason, 且 reason 不能改变 (不能改变即 ===, 值类型是值不可变, 引用类型是引用不可变)
- 2.2 then 方法: promise 必须提供 then 方法, 以访问其当前或最终的 value 或 reason, promise 的 then 方法接受两个参数 `promise.then(onFulfilled, onRejected)`
  - 2.2.1 onFulfilled 和 onRejected 都是可选参数
    - 2.2.1.1 如果 onFulfilled 不是函数, 则忽略
    - 2.2.1.2 如果 onRejected 不是函数, 则忽略
  - 2.2.2 如果 onFulfilled 是函数
    - 2.2.2.1 必须在 promise fulfilled 后调用 onFulfilled, 且使用 promise 的 value 作为第一个参数
    - 2.2.2.2 在 promise fulfilled 前不能调用 onFulfilled
    - 2.2.2.3 onFulfilled 只能调用 1 次
  - 2.2.3 如果 onRejected 是函数
    - 2.2.3.1 必须在 promise rejected 后调用 onRejected, 且使用 promise 的 reason 作为第一个参数
    - 2.2.3.2 在 promise rejected 前不能调用 onRejected
    - 2.2.3.3 onRejected 只能调用 1 次
  - 2.2.4 onFulfilled 和 onRejected 必须异步执行, 可以使用 setTimeout, setImmediate 等宏任务实现, 也可以使用 queueMicrotask, process.nextTick 等微任务实现
  - 2.2.5 onFulfilled 和 onRejected 必须作为函数调用（即 this === undefined）
  - 2.2.6 一个 promise 的 then 方法可以多次调用
    - 2.2.6.1 当 promise fulfilled 时, 所有 onFulfilled 回调 (onFulfilledCallbacks) 按顺序执行
    - 2.2.6.2 当 promise rejected 时, 所有 onRejected 回调 (onRejectedCallbacks) 按顺序执行
  - 2.2.7 then 方法返回一个 promise, 称为 promise2; then 方法的调用者称为 promise1
    - 2.2.7.1 如果 onFulfilled 或 onRejected 返回值 x, 则 then 方法使用 resolve(x) 返回一个 fulfilled 的 promise2, value 为 x
    - 2.2.7.2 如果 onFulfilled 或 onRejected 抛出异常 e, 则 then 方法使用 reject(e) 返回一个 rejected 的 promise2, reason 为 e
    - 2.2.7.3 如果 onFulfilled 不是函数, 且 promise1 是 fulfilled, 则 then 方法也返回一个 fulfilled 的 promise2, value 与 promise1 的 value 相同
      2.2.7.4 如果 onRejected 不是函数, 且 promise1 是 rejected, 则 then 方法也返回一个 rejected 的 promise2, reason 与 promise1 的 reason 相同
  - 2.3
    - 2.3.1 如果 promise 和 x 指向同一个对象, 则使用 TypeError 作为 reason, reject promise (如果不 reject promise, 则会导致无限循环)
    - 2.3.2 如果 x 是一个 promise, 则使用 x 的状态
      - 2.3.2.1 如果 x (一个 promise) 是 pending, 则 promise 必须保持 pending, 直到 x 被 resolve 或 reject
      - 2.3.2.2 如果 x (一个 promise) 是 fulfilled, 则 promise 也 fulfilled, value 与 x 的 value 相同
      - 2.3.2.3 如果 x (一个 promise) 是 rejected, 则 promise 也 rejected, reason 与 x 的 reason 相同
  - 2.3.3 如果 x 是一个对象或函数
    - 2.3.3.1 则令 then = x.then
    - 2.3.3.2 如果获取 x.then 导致抛出异常 e, 则使用 e 作为 reason, reject promise
    - 2.3.3.3 如果 then 是一个函数, 则使用 x 作为 this 调用 then 方法, 第 1 个参数是 resolvePromise, 第 2 个参数是 rejectPromise
      - 2.3.3.3.1 如果调用 resolvePromise 并传递 v 时, 则使用 v 作为 value, resolve promise
      - 2.3.3.3.2 如果调用 rejectPromise 并传递 reason 时, 则使用 r 作为 reason, reject promise
      - 2.3.3.3.3 如果同时调用 resolvePromise 和 rejectPromise, 或者对同一个参数进行多次调用, 则第一次调用优先, 后续调用都会被忽略
      - 2.3.3.3.4 如果调用 then 方法时抛出异常 e
        - 2.3.3.3.4.1 如果已调用 resolvePromise 或 rejectPromise, 则忽略
        - 2.3.3.3.4.2 否则使用 e 作为 reason, reject promise
    - 2.3.3.4 如果 then 不是一个函数, 则使用 x 作为 value, resolve promise
  - 2.3.4 如果 x 不是一个对象或函数, 则使用 x 作为 value, resolve promise

## QA

1. onFulfilled 和 onRejected 必须异步执行, 可以使用 setTimeout, setImmediate 等宏任务实现, 也可以使用 queueMicrotask, process.nextTick 等微任务实现

2. 什么是 Promise A+ 规范中的 promise1, promise2

`promise2 = promise1.then(onFulfilled, onRejected)`
