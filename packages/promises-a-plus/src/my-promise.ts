/**
 * 1.1 "promise" 有 then 方法的对象或函数, 行为符合本规范
 * 1.2 "thenable" 有 then 方法的对象或函数
 * 1.3 "value" 合法的 JS 值 (包括 undefined、thenable 或 promise)
 * 1.4 "exception" 使用 throw 语句抛出的值
 * 1.5 "reason" 代表 promise 被拒绝的原因
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// 2.1 promise 的三个状态: pending、fulfilled 或 rejected
enum PromiseState {
  PENDING = "pending",
  FULFILLED = "fulfilled",
  REJECTED = "rejected",
}

type Resolve<T> = (value: T | PromiseLike<T>) => void;
type Reject = (reason?: any) => void;
type OnFulfilled<T, TResult> =
  ((value: T) => TResult | PromiseLike<TResult>) | undefined | null;
type OnRejected<TResult> =
  ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null;

class MyPromise<T = any> {
  // 2.1.1 pending 时
  // 2.1.1.1 promise 可以转换为 fulfilled 或 rejected
  private _state: PromiseState = PromiseState.PENDING;

  // 2.1.2 fulfilled 时
  // 2.1.2.1 promise 不能转换为其他状态
  // 2.1.2.2 必须有一个 value, 且 value 不能改变
  // 不能改变即 ===, 值类型是值不可变, 引用类型是引用不可变
  private _value: any = undefined;

  // 2.1.3 rejected 时
  // 2.1.3.1 promise 不能转换为其他状态
  // 2.1.3.2 必须有一个 reason, 且 reason 不能改变
  // 不能改变即 ===, 值类型是值不可变, 引用类型是引用不可变
  private _reason: any = undefined;

  // 存储回调函数
  private _onFulfilledCallbacks: (() => void)[] = [];
  private _onRejectedCallbacks: (() => void)[] = [];

  constructor(executor: (resolve: Resolve<T>, reject: Reject) => void) {
    try {
      executor(this._resolve.bind(this), this._reject.bind(this));
    } catch (e) {
      this._reject(e);
    }
  }

  /**
   * The Promise Resolution Procedure
   *
   * @param x
   * @returns
   */
  private _resolve(x: any): void {
    // 2.1.2 fulfilled 时
    // 2.1.2.1 promise 不能转换为其他状态
    // 2.1.3 rejected 时
    // 2.1.3.1 promise 不能转换为其他状态
    if (this._state !== PromiseState.PENDING) return;

    // 2.3.1 如果 promise 和 x 指向同一个对象, 则使用 TypeError 作为 reason, reject promise
    // 如果不 reject promise, 则会导致无限循环
    if (x === this) {
      return this._reject(new TypeError("Chaining cycle detected for promise"));
    }

    // 2.3.2 如果 x 是一个 promise, 则使用 x 的状态
    if (x instanceof MyPromise) {
      // 2.3.2.1 如果 x (一个 promise) 是 pending, 则 promise 必须保持 pending, 直到 x 被 resolve 或 reject
      if (x._state === PromiseState.PENDING) {
        x.then(
          (v: any) => this._resolve(v),
          (r: any) => this._reject(r),
        );
        // 2.3.2.2 如果 x (一个 promise) 是 fulfilled, 则 promise 也 fulfilled, value 与 x 的 value 相同
      } else if (x._state === PromiseState.FULFILLED) {
        this._fulfill(x._value);
      } else {
        // 2.3.2.3 如果 x (一个 promise) 是 rejected, 则 promise 也 rejected, reason 与 x 的 reason 相同
        this._reject(x._reason);
      }
      return;
    }

    // 2.3.3 如果 x 是一个对象或函数
    if (x !== null && (typeof x === "object" || typeof x === "function")) {
      let then;
      try {
        // 2.3.3.1 则令 then = x.then
        then = x.then;
      } catch (e) {
        // 2.3.3.2 如果获取 x.then 导致抛出异常 e
        // 则使用 e 作为 reason, reject promise
        return this._reject(e);
      }

      if (typeof then === "function") {
        // 2.3.3.3 如果 then 是一个函数
        // 则使用 x 作为 this 调用 then 方法
        // 第 1 个参数是 resolvePromise, 第 2 个参数是 rejectPromise

        // 2.3.3.3.3 如果同时调用 resolvePromise 和 rejectPromise
        // 或者对同一个参数进行多次调用
        // 则第一次调用优先, 后续调用都会被忽略
        let called = false;

        // 2.3.3.3.1 如果调用 resolvePromise 并传递 v 时, 则使用 v 作为 value, resolve promise
        // 2.3.3.3.4.1 如果已调用 resolvePromise 或 rejectPromise, 则忽略
        const resolvePromise = (v: any) => {
          if (called) return;
          called = true;
          this._resolve(v);
        };

        // 2.3.3.3.2 如果调用 rejectPromise 并传递 reason 时, 则使用 r 作为 reason, reject promise
        // 2.3.3.3.4.1 如果已调用 resolvePromise 或 rejectPromise, 则忽略
        const rejectPromise = (r: any) => {
          if (called) return;
          called = true;
          this._reject(r);
        };

        try {
          then.call(x, resolvePromise, rejectPromise);
        } catch (e) {
          // 2.3.3.3.4 如果调用 then 方法时抛出异常 e
          // 2.3.3.3.4.1 如果已调用 resolvePromise 或 rejectPromise, 则忽略
          if (called) return;
          // 2.3.3.3.4.2 否则使用 e 作为 reason, reject promise
          this._reject(e);
        }
        return;
      }
    }

    // 2.3.3.4 如果 then 不是一个函数, 则使用 x 作为 value, resolve promise
    // 2.3.4 如果 x 不是一个对象或函数, 则使用 x 作为 value, resolve promise
    this._fulfill(x);
  }

  private _fulfill(value: any): void {
    if (this._state !== PromiseState.PENDING) return;
    this._state = PromiseState.FULFILLED;
    this._value = value;

    const callbacks = this._onFulfilledCallbacks;
    this._onFulfilledCallbacks = [];
    this._onRejectedCallbacks = [];

    for (const callback of callbacks) {
      callback();
    }
  }

  private _reject(reason: any): void {
    if (this._state !== PromiseState.PENDING) return;
    this._state = PromiseState.REJECTED;
    this._reason = reason;

    const callbacks = this._onRejectedCallbacks;
    this._onFulfilledCallbacks = [];
    this._onRejectedCallbacks = [];

    for (const callback of callbacks) {
      callback();
    }
  }

  // 2.2 then 方法
  // promise 必须提供 then 方法, 以访问其当前或最终的 value 或 reason
  // promise 的 then 方法接受两个参数
  public then<TResult1 = T, TResult2 = never>(
    // 2.2.1 onFulfilled 和 onRejected 都是可选参数
    onFulfilled?: OnFulfilled<T, TResult1>,
    onRejected?: OnRejected<TResult2>,
  ): MyPromise<TResult1 | TResult2> {
    // 2.2.7 then 方法返回一个 promise, 称为 promise2
    // then 方法的调用者称为 promise1
    return new MyPromise((resolve, reject) => {
      // 2.2.4 onFulfilled 和 onRejected 可以使用 setTimeout, setImmediate 等宏任务实现, 也可以使用 queueMicrotask, process.nextTick 等微任务实现
      const handleFulfilled = () => {
        queueMicrotask(() => {
          try {
            // 2.2.1.1 如果 onFulfilled 不是函数, 则忽略
            // 2.2.7.3 如果 onFulfilled 不是函数, 且 promise1 是 fulfilled
            // 则 then 方法也返回一个 fulfilled 的 promise2, value 与 promise1 的 value 相同
            if (typeof onFulfilled !== "function") {
              resolve(this._value);
            } else {
              // 2.2.2 如果 onFulfilled 是函数
              // 2.2.2.1 必须在 promise fulfilled 后调用 onFulfilled, 且使用 promise 的 value 作为第一个参数
              // 2.2.2.2 在 promise fulfilled 前不能调用 onFulfilled
              // 2.2.2.3 onFulfilled 只能调用 1 次
              // 2.2.5 onFulfilled 和 onRejected 必须作为函数调用（即 this === undefined）
              const x = onFulfilled.call(undefined, this._value);
              // 2.2.7.1 如果 onFulfilled 或 onRejected 返回值 x
              // 则 then 方法使用 resolve(x) 返回一个 fulfilled 的 promise2, value 为 x
              resolve(x);
            }
          } catch (e) {
            // 2.2.7.2 如果 onFulfilled 或 onRejected 抛出异常 e
            // 则 then 方法使用 reject(e) 返回一个 rejected 的 promise2, reason 为 e
            reject(e);
          }
        });
      };

      const handleRejected = () => {
        queueMicrotask(() => {
          try {
            // 2.2.1.2 如果 onRejected 不是函数, 则忽略
            // 2.2.7.4 如果 onRejected 不是函数, 且 promise1 是 rejected
            // 则 then 方法也返回一个 rejected 的 promise2, reason 与 promise1 的 reason 相同
            if (typeof onRejected !== "function") {
              reject(this._reason);
            } else {
              // 2.2.3 如果 onRejected 是函数
              // 2.2.3.1 必须在 promise rejected 后调用 onRejected, 且使用 promise 的 reason 作为第一个参数
              // 2.2.3.2 在 promise rejected 前不能调用 onRejected
              // 2.2.3.3 onRejected 只能调用 1 次
              // 2.2.5 onFulfilled 和 onRejected 必须作为函数调用（即 this === undefined）
              const x = onRejected.call(undefined, this._reason);
              resolve(x);
            }
          } catch (e) {
            // 2.2.7.2 如果 onFulfilled 或 onRejected 抛出异常 e
            // 则 then 方法使用 reject(e) 返回一个 rejected 的 promise2, reason 为 e
            reject(e);
          }
        });
      };

      //#region
      if (this._state === PromiseState.FULFILLED) {
        // 2.2.2.1 必须在 promise fulfilled 后调用 onFulfilled, 且使用 promise 的 value 作为第一个参数
        handleFulfilled();
      } else if (this._state === PromiseState.REJECTED) {
        // 2.2.3.1 必须在 promise rejected 后调用 onRejected, 且使用 promise 的 reason 作为第一个参数
        handleRejected();
      } else {
        // 2.2.6 一个 promise 的 then 方法可以多次调用
        // 2.2.6.1 当 promise fulfilled 时, 所有 onFulfilled 回调 (onFulfilledCallbacks) 按顺序执行
        this._onFulfilledCallbacks.push(handleFulfilled);
        // 2.2.6.2 当 promise rejected 时, 所有 onRejected 回调 (onRejectedCallbacks) 按顺序执行
        this._onRejectedCallbacks.push(handleRejected);
      }
      //#endregion
    });
  }

  public catch<TResult = never>(
    onRejected?: OnRejected<TResult>,
  ): MyPromise<T | TResult> {
    return this.then(undefined, onRejected);
  }

  public finally(onFinally?: (() => void) | undefined | null): MyPromise<T> {
    return this.then(
      (value) => {
        if (typeof onFinally !== "function") return value;
        return MyPromise.resolve(onFinally()).then(() => value);
      },
      (reason) => {
        if (typeof onFinally !== "function") throw reason;
        return MyPromise.resolve(onFinally()).then(() => {
          throw reason;
        });
      },
    );
  }

  static resolve(value: any): MyPromise<any> {
    if (value instanceof MyPromise && value.constructor === MyPromise) {
      return value;
    }
    return new MyPromise((resolve) => resolve(value));
  }

  static reject(reason: any): MyPromise<never> {
    return new MyPromise((_, reject) => reject(reason));
  }

  static all(promises: Iterable<any>): MyPromise<any[]> {
    return new MyPromise((resolve, reject) => {
      const pArray = Array.isArray(promises) ? promises : Array.from(promises);
      const n = pArray.length;
      if (n === 0) {
        resolve([]);
        return;
      }
      const results: any[] = new Array(n);
      let completed = 0;
      for (let i = 0; i < n; i++) {
        MyPromise.resolve(pArray[i]).then(
          (value: any) => {
            results[i] = value;
            completed++;
            if (completed === n) {
              resolve(results);
            }
          },
          (reason: any) => {
            reject(reason);
          },
        );
      }
    });
  }

  static allSettled(promises: Iterable<any>): MyPromise<any[]> {
    return new MyPromise((resolve) => {
      const pArray = Array.isArray(promises) ? promises : Array.from(promises);
      const n = pArray.length;
      const results: any[] = new Array(n);
      if (n === 0) {
        resolve([]);
        return;
      }

      let completed = 0;
      for (let i = 0; i < n; i++) {
        MyPromise.resolve(pArray[i]).then(
          (value: any) => {
            results[i] = { status: PromiseState.FULFILLED, value };
            completed++;
            if (completed === n) {
              resolve(results);
            }
          },
          (reason: any) => {
            results[i] = { status: PromiseState.REJECTED, reason };
            completed++;
            if (completed === n) {
              resolve(results);
            }
          },
        );
      }
    });
  }

  static any(promises: Iterable<any>): MyPromise<any> {
    return new MyPromise((resolve, reject) => {
      const pArray = Array.isArray(promises) ? promises : Array.from(promises);
      const n = pArray.length;
      const errors: any[] = new Array(n);
      if (n === 0) {
        reject(new AggregateError([], "All promises were rejected"));
        return;
      }

      let rejectedCount = 0;
      for (let i = 0; i < n; i++) {
        MyPromise.resolve(pArray[i]).then(
          (value: any) => {
            resolve(value);
          },
          (reason: any) => {
            errors[i] = reason;
            rejectedCount++;
            if (rejectedCount === n) {
              reject(new AggregateError(errors, "All promises were rejected"));
            }
          },
        );
      }
    });
  }

  static race(promises: Iterable<any>): MyPromise<any> {
    return new MyPromise((resolve, reject) => {
      const pArray = Array.isArray(promises) ? promises : Array.from(promises);
      for (const item of pArray) {
        MyPromise.resolve(item).then(resolve, reject);
      }
    });
  }

  static try<T>(fn: () => T | PromiseLike<T>): MyPromise<T> {
    return new MyPromise((resolve) => {
      resolve(fn());
    });
  }

  static withResolvers<T>() {
    let resolve!: Resolve<T>;
    let reject!: Reject;
    const promise = new MyPromise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}

export default MyPromise;
