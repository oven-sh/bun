import { describe, test, it, expect } from "bun:test";
import { setTimeout, setImmediate } from "node:timers/promises";

describe("setTimeout", () => {
  it("abort() does not emit global error", async () => {
    let unhandledRejectionCaught = false;

    process.on('unhandledRejection', () => {
      unhandledRejectionCaught = true;
    });
    
    const c = new AbortController();

    setTimeout(() => c.abort());

    await setTimeout(50, undefined, { signal: c.signal }).catch(() => "aborted");

    // let unhandledRejection to be fired
    await setTimeout()

    expect(unhandledRejectionCaught).to.be.false;
  });
});

describe("setImmediate", () => {
  it("abort() does not emit global error", async () => {
    let unhandledRejectionCaught = false;

    process.on('unhandledRejection', () => {
      unhandledRejectionCaught = true;
    });
    
    const c = new AbortController();

    setImmediate(() => c.abort());

    await setImmediate(undefined, { signal: c.signal }).catch(() => "aborted");

    // let unhandledRejection to be fired
    await setTimeout()

    expect(unhandledRejectionCaught).to.be.false;
  });
});
