interface Call<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class SingleFlightGroup {
  private m: Map<string, Call<unknown>> = new Map();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.m.get(key);
    if (existing) {
      return existing.promise as Promise<T>;
    }

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    promise.catch(() => {});
    const call: Call<T> = { promise, resolve, reject };
    this.m.set(key, call as Call<unknown>);

    try {
      const result = await fn();
      resolve(result);
      return result;
    } catch (err) {
      reject(err);
      throw err;
    } finally {
      this.m.delete(key);
    }
  }
}
