import { sleep, listen } from "bun";
import { describe, expect, it } from "bun:test";

describe("an https fetch to a silent TCP socket", () => {
  it("should respond to abort signals", async () => {
    const listener = listen({
      port: 0,
      hostname: "localhost",
      socket: {
        data() {},
      },
    });
    try {
      const signal = AbortSignal.timeout(1);
      const check_after = sleep(200);

      // After 1ms, the signal should abort the fetch and reject its promise. (with an http URL, this behaviour is seen)
      // As of this commit, however, the fetch will hang indefinitely.
      // We detect this by requiring the rejection after waiting 250ms.
      expect(() =>
        Promise.race([check_after, fetch(`https://127.0.0.1:${listener.port}`, { signal: signal })]),
      ).toThrow(new DOMException("The operation timed out."));
      await check_after;
      await sleep(1);
    } finally {
      listener.stop(true);
    }
  });
});
