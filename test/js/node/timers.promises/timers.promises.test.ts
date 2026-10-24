import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { setImmediate, setInterval, setTimeout } from "node:timers/promises";

describe("setTimeout", () => {
  it("abort() does not emit global error", async () => {
    let unhandledRejectionCaught = false;

    const catchUnhandledRejection = () => {
      unhandledRejectionCaught = true;
    };
    process.on("unhandledRejection", catchUnhandledRejection);

    const c = new AbortController();

    global.setTimeout(() => c.abort());

    await setTimeout(100, undefined, { signal: c.signal }).catch(() => "aborted");

    // let unhandledRejection to be fired
    await setTimeout(100);

    process.off("unhandledRejection", catchUnhandledRejection);

    expect(c.signal.aborted).toBe(true);
    expect(unhandledRejectionCaught).toBe(false);
  });

  it("AbortController can be passed as the `options` argument", () => {
    expect(async () => await setTimeout(0, undefined, new AbortController())).not.toThrow();
  });

  it("should reject promise when AbortController is aborted", async () => {
    const abortController = new AbortController();
    const promise = setTimeout(100, undefined, abortController);
    abortController.abort();

    await expect(promise).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(abortController.signal.aborted).toBe(true);
  });

  // abort() runs the listener synchronously, so the short delay can never win the
  // race: it only exists so a build that ignores the abort resolves and fails the
  // assertion rather than leaving the promise pending forever.
  it("rejects even when another listener stopped propagation", async () => {
    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", e => e.stopImmediatePropagation());

    const promise = setTimeout(1, "not-aborted", { signal: abortController.signal });
    abortController.abort();

    await expect(promise).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
  });
});

describe("setImmediate", () => {
  it("abort() does not emit global error", async () => {
    let unhandledRejectionCaught = false;

    const catchUnhandledRejection = () => {
      unhandledRejectionCaught = true;
    };
    process.on("unhandledRejection", catchUnhandledRejection);

    const c = new AbortController();

    global.setImmediate(() => c.abort());

    await setImmediate(undefined, { signal: c.signal }).catch(() => "aborted");

    // let unhandledRejection to be fired
    await setTimeout(100);

    process.off("unhandledRejection", catchUnhandledRejection);

    expect(c.signal.aborted).toBe(true);
    expect(unhandledRejectionCaught).toBe(false);
  });

  it("rejects even when another listener stopped propagation", async () => {
    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", e => e.stopImmediatePropagation());

    const promise = setImmediate("not-aborted", { signal: abortController.signal });
    abortController.abort();

    await expect(promise).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
  });
});

// node rejects with its own AbortError class (lib/internal/errors.js), whose
// default message has no trailing period. The DOMException stored in
// signal.reason keeps the WebIDL text with the period; it is only the cause.
describe("AbortError shape matches node", () => {
  function nodeAbortError(signal: AbortSignal) {
    return {
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
      cause: signal.reason,
    };
  }

  async function shapeOf(promise: Promise<unknown>) {
    const err: any = await promise.then(
      () => {
        throw new Error("expected a rejection");
      },
      e => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DOMException);
    return { name: err.name, code: err.code, message: err.message, cause: err.cause };
  }

  it("setTimeout with an already aborted signal", async () => {
    const signal = AbortSignal.abort();
    expect(await shapeOf(setTimeout(10, undefined, { signal }))).toEqual(nodeAbortError(signal));
    expect(signal.reason.message).toBe("The operation was aborted.");
  });

  it("setTimeout aborted while pending", async () => {
    const controller = new AbortController();
    const promise = setTimeout(10_000, undefined, { signal: controller.signal });
    controller.abort();
    expect(await shapeOf(promise)).toEqual(nodeAbortError(controller.signal));
  });

  it("setTimeout aborted with a custom reason", async () => {
    const reason = new Error("custom reason");
    const signal = AbortSignal.abort(reason);
    expect(await shapeOf(setTimeout(10, undefined, { signal }))).toEqual({ ...nodeAbortError(signal), cause: reason });
  });

  it("setImmediate with an already aborted signal", async () => {
    const signal = AbortSignal.abort();
    expect(await shapeOf(setImmediate(undefined, { signal }))).toEqual(nodeAbortError(signal));
  });

  it("setInterval with an already aborted signal", async () => {
    const signal = AbortSignal.abort();
    const iterate = (async () => {
      for await (const _ of setInterval(1, undefined, { signal })) break;
    })();
    expect(await shapeOf(iterate)).toEqual(nodeAbortError(signal));
  });
});

describe("setInterval", () => {
  it("ends the iterator even when another listener stopped propagation", async () => {
    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", e => e.stopImmediatePropagation());

    const iterator = setInterval(1, "tick", { signal: abortController.signal })[Symbol.asyncIterator]();
    try {
      const next = iterator.next();
      abortController.abort();

      await expect(next).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
    } finally {
      // On a build that ignores the abort the interval is still armed; clear it.
      await iterator.return!();
    }
  });

  // The iterator protocol itself is in timers-promises-interval-iterator.test.ts, which also runs under node.

  // As in node, the first next() starts the interval. Nothing reads this iterator, so nothing keeps the child alive.
  it.concurrent("an iterator that is never read does not keep the process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `require("node:timers/promises").setInterval(100_000_000); console.log("created");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "created\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // mock.timers of node:test replaces globalThis.clearInterval. This iterator started before that, so its
  // interval is a real one, and the child exits only if the real clearInterval stops it.
  it.concurrent("an iterator that is closed while node:test mock timers are enabled stops its interval", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { mock } = require("node:test");
         const { setInterval } = require("node:timers/promises");
         (async () => {
           const iterator = setInterval(1, "tick");
           await iterator.next();
           mock.timers.enable({ apis: ["setInterval"] });
           await iterator.return();
           mock.timers.reset();
           console.log("closed");
         })();`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "closed\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
