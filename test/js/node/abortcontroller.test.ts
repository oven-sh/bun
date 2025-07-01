import { describe, expect, test } from "bun:test";

describe("AbortController", () => {
  test("basic functionality", () => {
    const controller = new AbortController();
    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal).toBeInstanceOf(AbortSignal);
    expect(controller.signal.aborted).toBe(false);

    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(DOMException);
    expect(controller.signal.reason.name).toBe("AbortError");
  });

  test("abort with custom reason", () => {
    const controller = new AbortController();
    const customReason = new Error("Custom abort reason");
    controller.abort(customReason);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(customReason);
  });

  test("event listener for abort event", () => {
    return new Promise<void>(resolve => {
      const controller = new AbortController();
      let eventFired = false;

      controller.signal.addEventListener("abort", event => {
        eventFired = true;
        expect(event.type).toBe("abort");
        expect(controller.signal.aborted).toBe(true);
        resolve();
      });

      controller.abort();
      expect(eventFired).toBe(true);
    });
  });

  test("onabort property", () => {
    return new Promise<void>(resolve => {
      const controller = new AbortController();

      controller.signal.onabort = event => {
        expect(event.type).toBe("abort");
        expect(controller.signal.aborted).toBe(true);
        resolve();
      };

      controller.abort();
    });
  });

  test("throwIfAborted method", () => {
    const controller = new AbortController();

    // Should not throw when not aborted
    expect(() => controller.signal.throwIfAborted()).not.toThrow();

    // Should throw after abort
    controller.abort();
    expect(() => controller.signal.throwIfAborted()).toThrow(DOMException);

    try {
      controller.signal.throwIfAborted();
    } catch (error: unknown) {
      expect(error instanceof DOMException).toBe(true);
      if (error instanceof DOMException) {
        expect(error.name).toBe("AbortError");
      }
    }
  });

  test("throwIfAborted with custom reason", () => {
    const controller = new AbortController();
    const customReason = new Error("Custom abort reason");

    controller.abort(customReason);

    try {
      controller.signal.throwIfAborted();
    } catch (error: unknown) {
      expect(error).toBe(customReason);
    }
  });
});

describe("AbortSignal static methods", () => {
  test("AbortSignal.abort()", () => {
    const signal = AbortSignal.abort();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
  });

  test("AbortSignal.abort() with custom reason", () => {
    const customReason = new Error("Custom static abort reason");
    const signal = AbortSignal.abort(customReason);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(customReason);
  });

  test("AbortSignal.any()", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const anySignal = AbortSignal.any([controller1.signal, controller2.signal]);
    expect(anySignal).toBeInstanceOf(AbortSignal);
    expect(anySignal.aborted).toBe(false);

    return new Promise<void>(resolve => {
      anySignal.addEventListener("abort", () => {
        expect(anySignal.aborted).toBe(true);
        expect(anySignal.reason).toBeInstanceOf(DOMException);
        resolve();
      });

      // Abort one of the controllers
      controller1.abort();
    });
  });

  test("AbortSignal.any() with already aborted signal", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    controller1.abort();

    const anySignal = AbortSignal.any([controller1.signal, controller2.signal]);
    expect(anySignal.aborted).toBe(true);
  });
});

describe("AbortController", () => {
  test("abort with custom reason", () => {
    const controller = new AbortController();
    const reason = new Error("Custom abort reason");
    controller.abort(reason);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(reason);
  });

  test("abort event fires once", () => {
    const controller = new AbortController();
    let callCount = 0;

    controller.signal.addEventListener("abort", () => {
      callCount++;
    });

    controller.abort();
    controller.abort(); // Second abort should not trigger listener again

    expect(callCount).toBe(1);
  });

  test("onabort handler", () => {
    const controller = new AbortController();
    let handlerCalled = false;
    let eventType = "";

    controller.signal.onabort = event => {
      handlerCalled = true;
      eventType = event.type;
    };

    controller.abort();

    expect(handlerCalled).toBe(true);
    expect(eventType).toBe("abort");
  });

  test("throwIfAborted when not aborted", () => {
    const controller = new AbortController();
    expect(() => controller.signal.throwIfAborted()).not.toThrow();
  });

  test("throwIfAborted when aborted", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => controller.signal.throwIfAborted()).toThrow(DOMException);
    expect(() => controller.signal.throwIfAborted()).toThrow("The operation was aborted");
  });

  test("throwIfAborted with custom reason", () => {
    const controller = new AbortController();
    const reason = new TypeError("Custom abort type");
    controller.abort(reason);

    expect(() => controller.signal.throwIfAborted()).toThrow(TypeError);
    expect(() => controller.signal.throwIfAborted()).toThrow("Custom abort type");
  });
});

describe("AbortSignal.abort", () => {
  test("creates pre-aborted signal", () => {
    const signal = AbortSignal.abort();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect(signal.reason.name).toBe("AbortError");
  });

  test("creates signal with custom reason", () => {
    const reason = { message: "Custom object reason" };
    const signal = AbortSignal.abort(reason);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  test("abort event does not fire on pre-aborted signal", () => {
    const signal = AbortSignal.abort();
    let eventFired = false;

    signal.addEventListener("abort", () => {
      eventFired = true;
    });

    // The event should not fire because the signal is already aborted
    expect(eventFired).toBe(false);
  });
});

describe("AbortSignal.timeout", () => {
  test("creates signal that aborts after timeout", async () => {
    const signal = AbortSignal.timeout(50);
    expect(signal.aborted).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect(signal.reason.name).toBe("TimeoutError");
  });

  test("fires abort event after timeout", async () => {
    const signal = AbortSignal.timeout(50);
    let eventFired = false;

    signal.addEventListener("abort", () => {
      eventFired = true;
    });

    expect(eventFired).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(eventFired).toBe(true);
  });

  test("immediate timeout (0ms)", async () => {
    const signal = AbortSignal.timeout(0);
    // Even with 0ms, the abort happens on the next tick
    expect(signal.aborted).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(signal.aborted).toBe(true);
  });

  test("throws on invalid timeout values", () => {
    expect(() => AbortSignal.timeout(-1)).toThrow(TypeError);
    expect(() => AbortSignal.timeout(NaN)).toThrow(TypeError);
    expect(() => AbortSignal.timeout(Infinity)).toThrow(TypeError);
  });
});

describe("AbortSignal.any", () => {
  test("aborts when any signal aborts", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const anySignal = AbortSignal.any([controller1.signal, controller2.signal]);
    expect(anySignal.aborted).toBe(false);

    controller1.abort();
    expect(anySignal.aborted).toBe(true);
    expect(anySignal.reason).toBe(controller1.signal.reason);
  });

  test("aborts with reason from first aborted signal", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const reason1 = new Error("First controller aborted");
    const reason2 = new Error("Second controller aborted");

    const anySignal = AbortSignal.any([controller1.signal, controller2.signal]);

    controller2.abort(reason2);
    controller1.abort(reason1); // This should have no effect since controller2 already aborted

    expect(anySignal.aborted).toBe(true);
    expect(anySignal.reason).toBe(reason2);
  });

  test("aborts immediately if any signal is already aborted", () => {
    const abortedSignal = AbortSignal.abort("Already aborted");
    const controller = new AbortController();

    const anySignal = AbortSignal.any([abortedSignal, controller.signal]);

    expect(anySignal.aborted).toBe(true);
    expect(anySignal.reason).toBe("Already aborted");
  });

  test("works with empty array", () => {
    const anySignal = AbortSignal.any([]);
    expect(anySignal.aborted).toBe(false);
  });

  test("fires abort event", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const anySignal = AbortSignal.any([controller1.signal, controller2.signal]);
    let eventFired = false;

    anySignal.addEventListener("abort", () => {
      eventFired = true;
    });

    controller2.abort();
    expect(eventFired).toBe(true);
  });
});

describe("AbortSignal integration", () => {
  test("Promise with AbortSignal", async () => {
    expect.assertions(1);

    const controller = new AbortController();

    const promise = new Promise((resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(controller.signal.reason);
      });

      // Simulate a long operation
      setTimeout(resolve, 1000);
    });

    // Abort before the timeout completes
    controller.abort();

    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
    }
  });
});
