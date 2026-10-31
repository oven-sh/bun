import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { LazyPromise, notAwaited, SettledPromise, thenable } from "./returned-thenable";

const rejects = (message: string) => thenable((_resolve, reject) => reject(new Error(message)));
// then() hands its callbacks to a promise that was already rejected when the callback returned.
const forwardsRejected = (message: string) => {
  const rejected = Promise.reject(new Error(message));
  return thenable((resolve, reject) => {
    rejected.then(resolve, reject);
  });
};

test("a thenable that rejects", () => rejects("rejected thenable"));

test("a thenable that rejects on a later turn", () =>
  thenable((_resolve, reject) => {
    setImmediate(() => reject(new Error("rejected on a later turn")));
  }));

test("a thenable that forwards an already rejected promise", () => forwardsRejected("forwarded rejection"));

test("a thenable that calls reject, then resolve", () =>
  thenable((resolve, reject) => {
    reject(new Error("reject before resolve"));
    resolve();
  }));

test("a thenable that resolves with a thenable that rejects", () =>
  thenable(resolve => resolve(rejects("rejected after resolve with a thenable"))));

test("a thenable whose then() throws", () =>
  thenable(() => {
    throw new Error("then() threw");
  }));

test("a thenable whose then getter throws", () => {
  const value = {
    get then(): never {
      throw new Error("then getter threw");
    },
  };
  return value as unknown as PromiseLike<void>;
});

// The deadline ends the wait, and the tests after it still run.
test("a thenable that never settles", () => thenable(() => {}), 20);

test("a lazy Promise subclass that rejects", () =>
  new LazyPromise<void>((_resolve, reject) => setImmediate(() => reject(new Error("rejected lazy subclass")))));

test("an already fulfilled Promise subclass whose then() rejects", () =>
  new SettledPromise(() => Promise.reject(new Error("rejected in then()"))));

// then() constructs its result with `new NotConstructibleByThen(executor)`, and this constructor drops the executor.
class NotConstructibleByThen extends Promise<void> {
  constructor() {
    super(resolve => resolve());
  }
}
test("a Promise subclass that then() cannot construct", () => new NotConstructibleByThen());

// `await` resolves to such a promise itself. Its rejection stays unhandled, and that fails the test.
class WithoutThen extends Promise<void> {}
Object.defineProperty(WithoutThen.prototype, "then", { value: undefined });
test("a rejected Promise subclass whose then is not callable", () =>
  WithoutThen.reject(new Error("rejected without then")));

class ConstructorThrows extends Promise<void> {}
Object.defineProperty(ConstructorThrows.prototype, "constructor", {
  get() {
    throw new Error("constructor getter threw");
  },
});
test("a Promise subclass whose constructor getter throws", () => new ConstructorThrows(resolve => resolve()));
test("a Promise subclass whose constructor getter throws, with a done callback", done => {
  done();
  return new ConstructorThrows(resolve => resolve());
});

test.each(["a", "b"])("test.each row %s", row => rejects("rejected row " + row));

test.failing("test.failing", () => forwardsRejected("rejected under test.failing"));

describe("beforeEach", () => {
  beforeEach(() => rejects("rejected beforeEach"));
  test("the test does not run", () => {
    console.log("UNREACHABLE: the test ran after beforeEach rejected");
  });
});

describe("beforeAll", () => {
  beforeAll(() => rejects("rejected beforeAll"));
  test("the test does not run", () => {
    console.log("UNREACHABLE: the test ran after beforeAll rejected");
  });
});

test("the runner started the lazy promise", () => {
  expect(notAwaited.count).toBe(0);
});
