/* eslint-disable @typescript-eslint/no-explicit-any */

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
  private _state: PromiseState = PromiseState.PENDING;

  private _value: any = undefined;

  private _reason: any = undefined;

  private _onFulfilledCallbacks: (() => void)[] = [];
  private _onRejectedCallbacks: (() => void)[] = [];

  constructor(executor: (resolve: Resolve<T>, reject: Reject) => void) {
    try {
      executor(this._resolve.bind(this), this._reject.bind(this));
    } catch (e) {
      this._reject(e);
    }
  }

  private _resolve(x: any): void {
    if (this._state !== PromiseState.PENDING) return;

    if (x === this) {
      return this._reject(new TypeError("Chaining cycle detected for promise"));
    }

    if (x instanceof MyPromise) {
      if (x._state === PromiseState.PENDING) {
        x.then(
          (v: any) => this._resolve(v),
          (r: any) => this._reject(r),
        );
      } else if (x._state === PromiseState.FULFILLED) {
        this._fulfill(x._value);
      } else {
        this._reject(x._reason);
      }
      return;
    }

    if (x !== null && (typeof x === "object" || typeof x === "function")) {
      let then;
      try {
        then = x.then;
      } catch (e) {
        return this._reject(e);
      }

      if (typeof then === "function") {
        let called = false;

        const resolvePromise = (v: any) => {
          if (called) return;
          called = true;
          this._resolve(v);
        };

        const rejectPromise = (r: any) => {
          if (called) return;
          called = true;
          this._reject(r);
        };

        try {
          then.call(x, resolvePromise, rejectPromise);
        } catch (e) {
          if (called) return;
          this._reject(e);
        }
        return;
      }
    }

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

  public then<TResult1 = T, TResult2 = never>(
    onFulfilled?: OnFulfilled<T, TResult1>,
    onRejected?: OnRejected<TResult2>,
  ): MyPromise<TResult1 | TResult2> {
    return new MyPromise((resolve, reject) => {
      const handleFulfilled = () => {
        queueMicrotask(() => {
          try {
            if (typeof onFulfilled !== "function") {
              resolve(this._value);
            } else {
              const x = onFulfilled.call(undefined, this._value);
              resolve(x);
            }
          } catch (e) {
            reject(e);
          }
        });
      };

      const handleRejected = () => {
        queueMicrotask(() => {
          try {
            if (typeof onRejected !== "function") {
              reject(this._reason);
            } else {
              const x = onRejected.call(undefined, this._reason);
              resolve(x);
            }
          } catch (e) {
            reject(e);
          }
        });
      };

      if (this._state === PromiseState.FULFILLED) {
        handleFulfilled();
      } else if (this._state === PromiseState.REJECTED) {
        handleRejected();
      } else {
        this._onFulfilledCallbacks.push(handleFulfilled);
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
