import { describe, test, it, expect } from "bun:test";
import { setTimeout, setImmediate } from "node:timers/promises";

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
});
