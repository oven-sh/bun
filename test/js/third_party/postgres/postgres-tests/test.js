import { test as bunTest, expect } from "bun:test";

export const t = (...rest) => test(...rest);
t.timeout = 5;

async function test(name, options, fn) {
  typeof options !== "object" && ((fn = options), (options = {}));
  bunTest(
    name,
    async () => {
      const [expected, got] = await fn();
      expect(expected).toBe(got);
    },
    (options.timeout || t.timeout) * 1000,
  );
}
