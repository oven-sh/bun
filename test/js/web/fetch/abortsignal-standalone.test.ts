import { test, expect } from "bun:test";

for (let timeout of [1, 2, 0]) {
  test(`AbortSignal.timeout(${timeout})`, async () => {
    const count = 10_000;

    const promises = new Array(count);

    const signals = new Array(count);
    console.time("[" + count + "x] " + "AbortSignal.timeout(" + timeout + ")");
    for (let i = 0; i < count; i++) {
      const signal = AbortSignal.timeout(timeout);
      const { promise, resolve, reject } = Promise.withResolvers();
      promises[i] = promise;
      signals[i] = signal;
      signal.addEventListener("abort", () => {
        resolve();
      });
    }
    console.timeEnd("[" + count + "x] " + "AbortSignal.timeout(" + timeout + ")");

    console.time("[" + count + "x] " + "await Promise.all(promises)");
    await Promise.all(promises);
    console.timeEnd("[" + count + "x] " + "await Promise.all(promises)");
  });
}
