// Return values for the returned-thenable fixtures. Each does its work in `then()`.

/** An object that is not a promise and has the given function as its `then()`. */
export function thenable(then: (resolve: (value?: unknown) => void, reject: (reason: unknown) => void) => void) {
  return { then } as unknown as PromiseLike<void>;
}

/** How many values `startUnlessAwaited` had to start. A runner that awaits what a callback returns leaves it at 0. */
export const notAwaited = { count: 0 };

/**
 * Calls `value.then()` on the next turn of the event loop if nothing has called it by then. A runner that watches
 * the internal state of a lazy promise then finishes the file and fails an assertion on `notAwaited`, instead of
 * waiting for a value that never starts.
 */
export function startUnlessAwaited<T extends PromiseLike<unknown>>(value: T): T {
  const then = value.then;
  let called = false;
  value.then = function (this: T, ...args: Parameters<typeof then>) {
    called = true;
    return then.apply(this, args);
  } as typeof then;
  setImmediate(() => {
    if (called) return;
    notAwaited.count++;
    then.call(
      value,
      () => {},
      () => {},
    );
  });
  return value;
}

/** The shape of `Bun.$` and of a `Bun.SQL` query: a pending Promise subclass that starts its work in the first `then()`. */
export class LazyPromise<T> extends Promise<T> {
  static thenCalls = 0;
  #start: (() => void) | undefined;

  constructor(start: (resolve: (value: T) => void, reject: (reason: unknown) => void) => void) {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    super((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.#start = () => start(resolve, reject);
    startUnlessAwaited(this);
  }

  then(onFulfilled?: any, onRejected?: any): any {
    LazyPromise.thenCalls++;
    const start = this.#start;
    this.#start = undefined;
    start?.();
    return super.then(onFulfilled, onRejected);
  }

  static get [Symbol.species]() {
    return Promise;
  }
}

/** The shape of the openai SDK's APIPromise: the promise itself is fulfilled at once, and every `then()` does the work. */
export class SettledPromise<T> extends Promise<T> {
  static thenCalls = 0;
  #work: () => Promise<T>;

  constructor(work: () => Promise<T>) {
    super(resolve => resolve(undefined as T));
    this.#work = work;
  }

  then(onFulfilled?: any, onRejected?: any): any {
    SettledPromise.thenCalls++;
    return this.#work().then(onFulfilled, onRejected);
  }
}
