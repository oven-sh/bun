import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/33185
// A `return <expr>` in an async generator awaits the operand before completing,
// so `return Promise.resolve(v)` must resolve next() with v, not the Promise.
// The fix lives in Bun's JavaScriptCore fork (ReturnNode::emitBytecode): the
// operand must not be emitted as a tail call, which would skip the await.

test("async generator return Promise.resolve is awaited", async () => {
  async function* gen() {
    return Promise.resolve("resolved");
  }
  const res = await gen().next();
  expect(res).toEqual({ value: "resolved", done: true });
  expect(res.value).not.toBeInstanceOf(Promise);
});

test("async generator return of call expressions is awaited", async () => {
  async function* all() {
    return Promise.all([Promise.resolve("a"), Promise.resolve("b")]);
  }
  async function* race() {
    return Promise.race([Promise.resolve("c")]);
  }
  async function* asyncIIFE() {
    return (async () => "d")();
  }
  expect((await all().next()).value).toEqual(["a", "b"]);
  expect((await race().next()).value).toBe("c");
  expect((await asyncIIFE().next()).value).toBe("d");
});

test("async generator return of a rejected promise rejects next()", async () => {
  async function* gen() {
    return Promise.reject(new Error("boom"));
  }
  await expect(gen().next()).rejects.toThrow("boom");
});

test("async generator return of a thenable is awaited", async () => {
  async function* gen() {
    return { then: (resolve: (v: string) => void) => resolve("thenable") };
  }
  expect((await gen().next()).value).toBe("thenable");
});

test("async generator yield then return Promise is awaited", async () => {
  async function* gen() {
    yield 1;
    return Promise.resolve("last");
  }
  const it = gen();
  expect(await it.next()).toEqual({ value: 1, done: false });
  const ret = await it.next();
  expect(ret).toEqual({ value: "last", done: true });
  expect(ret.value).not.toBeInstanceOf(Promise);
});
