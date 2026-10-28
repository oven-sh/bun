import { expect, test } from "bun:test";
import { createHook } from "node:async_hooks";

const tickFrame = /^at processTicksAndRejections \(native:\d+:\d+\)$/;
const nextTickFrame = /^at nextTick \(native:\d+:\d+\)$/;

function framesOf(stack: string | undefined) {
  return stack!
    .split("\n")
    .slice(1)
    .map(line => line.trim());
}

function inTick<T>(run: () => T, ...args: unknown[]) {
  const { promise, resolve } = Promise.withResolvers<T>();
  process.nextTick(() => resolve(run()), ...args);
  return promise;
}

test("process.nextTick has the properties of a native function", () => {
  const { nextTick } = process;
  expect(Function.prototype.toString.call(nextTick)).toBe("function nextTick() { [native code] }");
  expect(Reflect.ownKeys(nextTick)).toEqual(["length", "name"]);
  expect(nextTick.name).toBe("nextTick");
  expect(nextTick.length).toBe(1);
  expect(nextTick.prototype).toBeUndefined();
  expect(Bun.inspect(nextTick)).toBe("[Function: nextTick]");
});

test.each([0, 1, 2, 3, 4, 5])("below a callback that was queued with %d arguments is one native frame", async count => {
  const frames = framesOf(await inTick(() => new Error().stack, ...Array(count).fill(0)));
  expect(frames.slice(2)).toEqual([expect.stringMatching(tickFrame)]);
});

test("the call site of the frame that runs the ticks is native", async () => {
  const site = await inTick(() => {
    const before = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, sites) => sites.at(-1);
    try {
      return new Error().stack as unknown as NodeJS.CallSite;
    } finally {
      Error.prepareStackTrace = before;
    }
  });
  expect(site.getFunctionName()).toBe("processTicksAndRejections");
  expect(site.isNative()).toBe(true);
  expect(site.getLineNumber()).toBeGreaterThan(0);
  expect(site.getColumnNumber()).toBeGreaterThan(0);
  expect(String(site)).toBe("processTicksAndRejections (native)");
});

test("a promise job and a tick that a tick queues run above the same frame", async () => {
  const { promise, resolve } = Promise.withResolvers<(string | undefined)[]>();
  process.nextTick(() => {
    Promise.resolve().then(() => {
      const job = new Error().stack;
      process.nextTick(() => resolve([job, new Error().stack]));
    });
  });
  for (const stack of await promise) expect(framesOf(stack).slice(1)).toEqual([expect.stringMatching(tickFrame)]);
});

test("an error for a callback that is no function is thrown below a native frame of nextTick", () => {
  let error: NodeJS.ErrnoException | undefined;
  try {
    // @ts-expect-error
    process.nextTick(1);
  } catch (thrown) {
    error = thrown as NodeJS.ErrnoException;
  }
  expect(error!.code).toBe("ERR_INVALID_ARG_TYPE");
  const frames = framesOf(error!.stack);
  const at = frames.findIndex(frame => nextTickFrame.test(frame));
  expect(at).toBeGreaterThan(-1);
  expect(frames[at + 1]).toContain(import.meta.filename);
  expect(frames.filter(frame => frame.includes("nextTick"))).toEqual([expect.stringMatching(nextTickFrame)]);
});

test("an init hook is called by the native frame of nextTick", () => {
  let stack: string | undefined;
  const hook = createHook({
    init(_, type) {
      if (type === "TickObject") stack ??= new Error().stack;
    },
  }).enable();
  try {
    process.nextTick(() => {});
  } finally {
    hook.disable();
  }
  expect(framesOf(stack)[1]).toMatch(nextTickFrame);
});
