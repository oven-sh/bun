import { describe, expect, test } from "bun:test";
import { LazyPromise, notAwaited, thenable } from "./returned-thenable";

let thenCalls = 0;

describe("a lazy Promise subclass from describe", () =>
  new LazyPromise<void>(resolve =>
    setImmediate(() => {
      test("is started by the runner, and the tests it adds belong to the describe", () => {
        expect(notAwaited.count).toBe(0);
      });
      resolve();
    }),
  ));

describe("a thenable from describe", () => {
  test("is not awaited", () => {
    expect(thenCalls).toBe(0);
  });
  return thenable(() => {
    thenCalls++;
  });
});

class ConstructorThrows extends Promise<void> {}
Object.defineProperty(ConstructorThrows.prototype, "constructor", {
  get() {
    throw new Error("constructor getter threw");
  },
});
describe("a Promise subclass whose constructor getter throws, from describe", () => {
  test("the describe fails", () => {});
  return new ConstructorThrows(resolve => resolve());
});
