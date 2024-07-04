import { describe, test, it, expect } from "bun:test";
import { setTimeout, setImmediate } from "node:timers/promises";

for (const fn of [setTimeout, setImmediate]) {
  describe(fn.name, () => {
    it("abort() does not emit global error", async () => {
      let unhandledRejectionCaught = false;

      process.on('unhandledRejection', () => {
        unhandledRejectionCaught = true;
      });
      
      const c = new AbortController();

      global[fn.name](() => c.abort());

      await fn(100, undefined, { signal: c.signal }).catch(() => "aborted");

      expect(unhandledRejectionCaught).to.be.false;
    });
  });
}
