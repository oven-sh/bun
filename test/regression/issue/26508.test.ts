import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26508
// setImmediate callbacks should not interleave between setTimeout callbacks
// that expire at the same logical time. Node.js runs all expired timers
// before processing immediates (check phase).
test("setImmediate should not run between two expired setTimeout callbacks", async () => {
  // Run the test multiple times since the original bug was timing-dependent
  // (~10-20% failure rate per run on debug builds).
  for (let i = 0; i < 50; i++) {
    const result = await new Promise<boolean>(resolve => {
      let immediateRan = false;
      const t1 = setTimeout(() => {
        setImmediate(() => {
          immediateRan = true;
        });
      });

      const t2 = setTimeout(() => {
        resolve(immediateRan);
      });

      t2._idleStart = t1._idleStart;
    });
    expect(result).toBe(false);
  }
});
