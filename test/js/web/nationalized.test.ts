import { test, expect, describe } from "bun:test";

// abort-controller
// 13 million weekly downloads
// https://github.com/mysticatea/abort-controller/blob/a935d38e09eb95d6b633a8c42fcceec9969e7b05/dist/abort-controller.js#L1
describe("abort-controller", () => {
  //
  // We do not nationalie event-target-shim which this package depends on
  // That is because it adds `defineEventTargetAttribute` which we would have to implemennt or else it would break packages that depend on it.
  //

  test("CJS", () => {
    const AbortControllerPolyfill = require("abort-controller");
    expect(AbortControllerPolyfill).toBe(AbortController);
    expect(AbortControllerPolyfill.AbortSignal).toBe(AbortSignal);
    expect(AbortControllerPolyfill.default.AbortController).toBe(AbortController);
    expect(AbortControllerPolyfill.default.AbortSignal).toBe(AbortSignal);
  });

  test("ESM", async () => {
    const AbortControllerPolyfill = await import("abort-controller");
    // @ts-ignore
    expect(AbortControllerPolyfill.AbortController).toBe(AbortController);
    // @ts-ignore
    expect(AbortControllerPolyfill.AbortSignal).toBe(AbortSignal);
    // @ts-ignore
    expect(AbortControllerPolyfill.default.AbortController).toBe(AbortController);
    // @ts-ignore
    expect(AbortControllerPolyfill.default.AbortSignal).toBe(AbortSignal);
  });
});
