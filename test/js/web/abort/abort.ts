import { gc } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";

async function expectMaxObjectTypeCount(
  expect: typeof import("bun:test").expect,
  type: string,
  count: number,
  maxWait = 1000,
) {
  gc(true);
  if (heapStats().objectTypeCounts[type] <= count) return;
  gc(true);
  for (const wait = 20; maxWait > 0; maxWait -= wait) {
    if (heapStats().objectTypeCounts[type] <= count) break;
    await new Promise(resolve => setTimeout(resolve, wait));
    gc(true);
  }
  expect(heapStats().objectTypeCounts[type]).toBeLessThanOrEqual(count);
}

describe("AbortSignal", () => {
  test("constructor", () => {
    expect(() => new AbortSignal()).toThrow(TypeError);
  });
  describe("abort()", () => {
    const reasons = [
      {
        label: "undefined",
        reason: undefined,
      },
      {
        label: "null",
        reason: null,
      },
      {
        label: "string",
        reason: "Aborted!",
      },
      {
        label: "Error",
        reason: new Error("Aborted!"),
      },
      {
        label: "object",
        reason: {
          ok: false,
          error: "Aborted!",
        },
      },
    ];
    for (const { label, reason } of reasons) {
      test(label, () => {
        const signal = AbortSignal.abort(reason);
        expect(signal instanceof AbortSignal).toBe(true);
        expect(signal).toHaveProperty("aborted", true);
        if (reason === undefined) {
          expect(signal).toHaveProperty("reason");
          expect(signal.reason instanceof DOMException).toBe(true);
        } else {
          expect(signal).toHaveProperty("reason", reason);
        }
      });
    }
  });
  describe("timeout()", () => {
    const valid = [
      {
        label: "0",
        timeout: 0,
      },
      {
        label: "1",
        timeout: 1,
      },
      {
        label: "Number.MAX_SAFE_INTEGER",
        timeout: Number.MAX_SAFE_INTEGER,
      },
    ];
    for (const { label, timeout } of valid) {
      test(label, () => {
        const signal = AbortSignal.timeout(timeout);
        expect(signal instanceof AbortSignal).toBe(true);
        expect(signal instanceof EventTarget).toBe(true);
        expect(signal).toHaveProperty("aborted", false);
        expect(signal).toHaveProperty("reason", undefined);
      });
    }
    const invalid = [
      {
        label: "-1",
        timeout: -1,
      },
      {
        label: "NaN",
        timeout: NaN,
      },
      {
        label: "Infinity",
        timeout: Infinity,
      },
      {
        label: "Number.MAX_VALUE",
        timeout: Number.MAX_VALUE,
      },
    ];
    for (const { label, timeout } of invalid) {
      test(label, () => {
        expect(() => AbortSignal.timeout(timeout)).toThrow(TypeError);
      });
    }
    // FIXME: test runner hangs when this is enabled
    test.skip("timeout works", done => {
      const abort = AbortSignal.timeout(1);
      abort.addEventListener("abort", event => {
        done();
      });
      // AbortSignal.timeout doesn't keep the event loop / process alive
      // so we set a no-op timeout
      setTimeout(() => {}, 10);
    });
  });
  describe("prototype", () => {
    test("aborted", () => {
      expect(AbortSignal.abort()).toHaveProperty("aborted", true);
      expect(AbortSignal.timeout(0)).toHaveProperty("aborted", false);
    });
    test("reason", () => {
      expect(AbortSignal.abort()).toHaveProperty("reason");
      expect(AbortSignal.timeout(0)).toHaveProperty("reason");
    });
    test("onabort", done => {
      const signal = AbortSignal.timeout(0);
      expect(signal.onabort).toBeNull();
      const onabort = (event: Event) => {
        expect(event instanceof Event).toBe(true);
        done();
      };
      expect(() => (signal.onabort = onabort)).not.toThrow();
      expect(signal.onabort).toStrictEqual(onabort);
      setTimeout(() => {}, 1);
    });
  });
});

describe("AbortController", () => {
  test("contructor", () => {
    expect(() => new AbortController()).not.toThrow();
  });
  describe("prototype", () => {
    test("signal", () => {
      const controller = new AbortController();
      expect(controller).toHaveProperty("signal");
      expect(controller.signal instanceof AbortSignal).toBe(true);
    });
    describe("abort()", () => {
      test("signal and controller are garbage collected", async () => {
        (function () {
          var last;
          class MyAbortSignalReasonGCTest {}
          for (let i = 0; i < 1e3; i++) {
            const controller = new AbortController();
            var escape;
            controller.signal.onabort = reason => {
              escape = reason;
            };
            controller.abort(new MyAbortSignalReasonGCTest());
            last = escape;
            new MyAbortSignalReasonGCTest();
          }

          return last;
        })();
        await expectMaxObjectTypeCount(expect, "AbortController", 3);
        await expectMaxObjectTypeCount(expect, "AbortSignal", 3);
      });
      const reasons = [
        {
          label: "undefined",
          reason: undefined,
        },
        {
          label: "string",
          reason: "The operation was aborted.",
        },
        {
          label: "Error",
          reason: new DOMException("The operation was aborted."),
        },
      ];
      for (const { label, reason } of reasons) {
        test(label, () => {
          const controller = new AbortController();
          let event: Event | undefined;
          expect(() => {
            controller.signal.onabort = data => {
              event = data;
            };
          }).not.toThrow();
          expect(controller).toHaveProperty("abort");
          expect(() => controller.abort()).not.toThrow();
          expect(event instanceof Event).toBe(true);
          expect(controller.signal.aborted).toBe(true);
          if (reason === undefined) {
            expect(controller.signal.reason instanceof DOMException).toBe(true);
          } else if (reason instanceof DOMException) {
            expect(controller.signal.reason).toBeInstanceOf(reason.constructor);
          } else {
            expect(controller.signal.reason.message).toStrictEqual(reason);
          }
        });
      }
    });
  });
});
