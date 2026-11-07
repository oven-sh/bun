// Promise subclasses with their own then(), for callbacks whose returned promise Bun waits on.

export const NOT_AWAITED = "then() was not called on a promise that starts its work in then()";

type OnFulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type OnRejected<B> = ((reason: any) => B | PromiseLike<B>) | null;

// A wait that only reads the state of a promise never starts work that then() starts. So that such
// a wait fails with an error and not with a timeout, a pending value that nothing called then() on
// rejects with NOT_AWAITED on the next turn of the event loop.
function rejectUnlessAwaited(promise: Promise<unknown> & { thenCalls: number }, reject: (reason: unknown) => void) {
  setImmediate(() => {
    if (promise.thenCalls) return;
    // Only a wait on the state sees this rejection, so it is not an unhandled one.
    Promise.prototype.then.call(promise, undefined, () => {});
    reject(new Error(NOT_AWAITED));
  });
}

/**
 * A pending promise that starts `work` when then() is first called and settles with its result:
 * the shape of `Bun.$` and of a `Bun.sql` query.
 */
export class LazyPromise<T> extends Promise<T> {
  thenCalls = 0;
  #start: (() => void) | undefined;

  static get [Symbol.species]() {
    return Promise;
  }

  constructor(work: () => T | PromiseLike<T>) {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    super((a, b) => {
      resolve = a;
      reject = b;
    });
    this.#start = () => {
      try {
        resolve(work());
      } catch (e) {
        reject(e);
      }
    };
    rejectUnlessAwaited(this, reject);
  }

  then<A = T, B = never>(onFulfilled?: OnFulfilled<T, A>, onRejected?: OnRejected<B>): Promise<A | B> {
    this.thenCalls++;
    const start = this.#start;
    this.#start = undefined;
    start?.();
    return super.then(onFulfilled, onRejected);
  }
}

export const lazy = <T>(work: () => T | PromiseLike<T>) => new LazyPromise<T>(work);

/**
 * A promise whose own state never carries the result: then() runs `work` once and hands its result
 * to the callbacks. `settled: true` is the shape of `p-lazy`, whose promise is fulfilled with
 * `undefined` when it is made. `settled: false` stays pending.
 */
export class DelegatingPromise<T> extends Promise<T> {
  thenCalls = 0;
  #work: () => T | PromiseLike<T>;
  #result: Promise<T> | undefined;

  static get [Symbol.species]() {
    return Promise;
  }

  constructor(work: () => T | PromiseLike<T>, settled: boolean) {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    super((a, b) => {
      resolve = a;
      reject = b;
    });
    this.#work = work;
    if (settled) resolve(undefined as T);
    else rejectUnlessAwaited(this, reject);
  }

  then<A = T, B = never>(onFulfilled?: OnFulfilled<T, A>, onRejected?: OnRejected<B>): Promise<A | B> {
    this.thenCalls++;
    this.#result ??= new Promise<T>(resolve => resolve(this.#work()));
    return this.#result.then(onFulfilled, onRejected);
  }
}

export const delegating = <T>(work: () => T | PromiseLike<T>, { settled }: { settled: boolean }) =>
  new DelegatingPromise<T>(work, settled);
