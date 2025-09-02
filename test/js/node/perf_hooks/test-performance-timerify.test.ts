import { describe, expect, test } from "bun:test";
import { performance, PerformanceObserver } from "perf_hooks";

describe("performance.timerify", () => {
  test("should wrap a function and measure its performance", done => {
    const obs = new PerformanceObserver(list => {
      const entries = list.getEntries();
      expect(entries.length).toBe(1);
      const entry = entries[0];
      expect(entry.name).toBe("noop");
      expect(entry.entryType).toBe("function");
      expect(typeof entry.duration).toBe("number");
      expect(typeof entry.startTime).toBe("number");
      obs.disconnect();
      done();
    });
    obs.observe({ entryTypes: ["function"] });

    function noop() {}
    const timerified = performance.timerify(noop);
    timerified();
  });

  test("should preserve function return value", () => {
    function returnsOne() {
      return 1;
    }
    const timerified = performance.timerify(returnsOne);
    expect(timerified()).toBe(1);
  });

  test("should preserve arrow function return value", () => {
    const timerified = performance.timerify(() => 42);
    expect(timerified()).toBe(42);
  });

  test("should handle constructor calls", done => {
    class TestClass {
      value: number;
      constructor(val: number) {
        this.value = val;
      }
    }

    const obs = new PerformanceObserver(list => {
      const entries = list.getEntries();
      expect(entries.length).toBe(1);
      const entry = entries[0];
      expect(entry.name).toBe("TestClass");
      expect(entry.entryType).toBe("function");
      expect(entry[0]).toBe(123); // First argument
      obs.disconnect();
      done();
    });
    obs.observe({ entryTypes: ["function"] });

    const TimerifiedClass = performance.timerify(TestClass);
    const instance = new TimerifiedClass(123);
    expect(instance).toBeInstanceOf(TestClass);
    expect(instance.value).toBe(123);
  });

  test("should capture function arguments in entry", done => {
    const obs = new PerformanceObserver(list => {
      const entries = list.getEntries();
      const entry = entries[0];
      expect(entry[0]).toBe(1);
      expect(entry[1]).toBe("abc");
      expect(entry[2]).toEqual({ x: 3 });
      obs.disconnect();
      done();
    });
    obs.observe({ entryTypes: ["function"] });

    function testFunc(a: number, b: string, c: object) {
      return a;
    }
    const timerified = performance.timerify(testFunc);
    timerified(1, "abc", { x: 3 });
  });

  test("should bubble up errors from wrapped function", () => {
    const obs = new PerformanceObserver(() => {
      throw new Error("Should not be called");
    });
    obs.observe({ entryTypes: ["function"] });

    function throwsError() {
      throw new Error("test error");
    }
    const timerified = performance.timerify(throwsError);

    expect(() => timerified()).toThrow("test error");
    obs.disconnect();
  });

  test("should handle async functions", async () => {
    let observerCalled = false;
    const obs = new PerformanceObserver(list => {
      const entries = list.getEntries();
      expect(entries.length).toBe(1);
      const entry = entries[0];
      expect(entry.name).toBe("asyncFunc");
      expect(entry.entryType).toBe("function");
      expect(typeof entry.duration).toBe("number");
      expect(entry.duration).toBeGreaterThanOrEqual(50); // Should be at least 50ms
      observerCalled = true;
      obs.disconnect();
    });
    obs.observe({ entryTypes: ["function"] });

    async function asyncFunc() {
      await new Promise(resolve => setTimeout(resolve, 50));
      return "done";
    }

    const timerified = performance.timerify(asyncFunc);
    const result = await timerified();
    expect(result).toBe("done");

    // Wait a bit for the observer to be called
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(observerCalled).toBe(true);
  });

  test("should preserve function properties", () => {
    function original(a: number, b: string = "default") {
      return a;
    }
    const timerified = performance.timerify(original);

    expect(timerified.length).toBe(original.length);
    expect(timerified.name).toBe("timerified original");
  });

  test("should handle anonymous functions", () => {
    const timerified = performance.timerify(function () {
      return 1;
    });
    expect(timerified.name).toBe("timerified anonymous");
    expect(timerified()).toBe(1);
  });

  test("should allow wrapping the same function multiple times", () => {
    function func() {}
    const timerified1 = performance.timerify(func);
    const timerified2 = performance.timerify(func);
    const timerified3 = performance.timerify(timerified1);

    expect(timerified1).not.toBe(timerified2);
    expect(timerified1).not.toBe(timerified3);
    expect(timerified2).not.toBe(timerified3);
    expect(timerified3.name).toBe("timerified timerified func");
  });

  test("should validate function argument", () => {
    const invalidInputs = [1, {}, [], null, undefined, "string", Infinity];
    for (const input of invalidInputs) {
      expect(() => performance.timerify(input as any)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    }
  });

  test("should validate options argument", () => {
    function func() {}

    // Should accept empty options
    expect(() => performance.timerify(func, {})).not.toThrow();

    // Should accept undefined options
    expect(() => performance.timerify(func)).not.toThrow();

    // Should reject non-object options
    expect(() => performance.timerify(func, "invalid" as any)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  test("should validate histogram option", () => {
    function func() {}

    // Invalid histogram types
    const invalidHistograms = [1, "", {}, [], false];
    for (const histogram of invalidHistograms) {
      expect(() => performance.timerify(func, { histogram })).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    }

    // Valid histogram (with record method)
    const validHistogram = { record: () => {} };
    expect(() => performance.timerify(func, { histogram: validHistogram })).not.toThrow();
  });

  test("should preserve 'this' context", () => {
    const obj = {
      value: 42,
      getValue() {
        return this.value;
      },
    };

    obj.getValue = performance.timerify(obj.getValue);
    expect(obj.getValue()).toBe(42);
  });

  test("should work with class methods", done => {
    class MyClass {
      value = 100;

      getValue() {
        return this.value;
      }
    }

    const obs = new PerformanceObserver(list => {
      const entries = list.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].name).toBe("getValue");
      obs.disconnect();
      done();
    });
    obs.observe({ entryTypes: ["function"] });

    const instance = new MyClass();
    instance.getValue = performance.timerify(instance.getValue);
    expect(instance.getValue()).toBe(100);
  });

  test("should handle functions that return promises", async () => {
    let observerCalled = false;
    const obs = new PerformanceObserver(list => {
      const entries = list.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].name).toBe("returnsPromise");
      observerCalled = true;
      obs.disconnect();
    });
    obs.observe({ entryTypes: ["function"] });

    function returnsPromise() {
      return Promise.resolve(123);
    }

    const timerified = performance.timerify(returnsPromise);
    const result = await timerified();
    expect(result).toBe(123);

    // Wait for observer
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(observerCalled).toBe(true);
  });

  test("should not call constructor as regular function", () => {
    class C {}
    const wrapped = performance.timerify(C);

    expect(() => wrapped()).toThrow(TypeError);
    expect(new wrapped()).toBeInstanceOf(C);
  });

  test("entry should have toJSON method", done => {
    const obs = new PerformanceObserver(list => {
      const entry = list.getEntries()[0];
      const json = entry.toJSON();
      expect(json).toHaveProperty("name", "func");
      expect(json).toHaveProperty("entryType", "function");
      expect(json).toHaveProperty("startTime");
      expect(json).toHaveProperty("duration");
      expect(json).toHaveProperty("detail");
      expect(Array.isArray(json.detail)).toBe(true);
      obs.disconnect();
      done();
    });
    obs.observe({ entryTypes: ["function"] });

    function func(x: number) {}
    const timerified = performance.timerify(func);
    timerified(42);
  });
});
