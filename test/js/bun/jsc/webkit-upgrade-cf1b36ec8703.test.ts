import { describe, expect, test } from "bun:test";

// Coverage for the WebKit cf1b36ec8703 sync (oven-sh/WebKit#614). Each case pins
// an observable behavior difference between the previous JSC and the new one.
//
// WebKit/WebKit#73407: a generator, async function, async arrow or async
// generator body has no tail position
// (https://tc39.es/ecma262/#sec-static-semantics-isintailposition), so
// `return f()` there is an ordinary call. The previous engine emitted a tail
// call, which replaces the frame of the body with the frame of `f`.

describe.concurrent("WebKit cf1b36ec8703 upgrade", () => {
  // `return x` in an async generator awaits `x` before the generator completes.
  // The tail call returned the promise to the caller and skipped that await.
  describe("an async generator awaits the call it returns (oven-sh/bun#33185)", () => {
    const f = () => Promise.resolve(42);
    const object = { f };
    const tag = (_: TemplateStringsArray) => f();
    // Destructured so that the transpiler cannot fold `yes ? f() : 0` to `f()`.
    const [yes, no, nothing] = [true, false, null];

    const shapes: Record<string, () => AsyncGenerator<unknown, unknown>> = {
      "Promise.resolve(v)": async function* () {
        return Promise.resolve(42);
      },
      "f()": async function* () {
        return f();
      },
      "object.f()": async function* () {
        return object.f();
      },
      "f?.()": async function* () {
        return f?.();
      },
      "f(...[])": async function* () {
        return f(...[]);
      },
      "f.call()": async function* () {
        return f.call(null);
      },
      "f.apply()": async function* () {
        return f.apply(null, []);
      },
      "a tagged template": async function* () {
        return tag`x`;
      },
      "an async arrow call": async function* () {
        return (async () => 42)();
      },
      "c ? f() : 0": async function* () {
        return yes ? f() : 0;
      },
      "a && f()": async function* () {
        return yes && f();
      },
      "a || f()": async function* () {
        return no || f();
      },
      "a ?? f()": async function* () {
        return nothing ?? f();
      },
      "in nested statements": async function* () {
        if (yes) {
          for (;;) {
            switch (0) {
              default:
                return f();
            }
          }
        }
      },
      "in a catch block": async function* () {
        try {
          throw 0;
        } catch {
          return f();
        }
      },
      "in a finally block": async function* () {
        try {
        } finally {
          return f();
        }
      },
      "after a yield": async function* () {
        yield 1;
        return f();
      },
      "in an object method": {
        async *method() {
          return f();
        },
      }.method,
      "in a class method": new (class {
        async *method() {
          return f();
        }
      })().method,
    };

    test.each(Object.keys(shapes))("%s", async name => {
      const generator = shapes[name]();
      let result = await generator.next();
      while (!result.done) result = await generator.next();
      expect(result).toEqual({ value: 42, done: true });
    });

    test("a rejected promise rejects next()", async () => {
      // The previous engine resolved next() with the rejected promise. Nothing
      // handled that promise, so it was also reported as an unhandled rejection.
      async function* generator() {
        return Promise.reject(new Error("boom"));
      }
      await expect(generator().next()).rejects.toThrow("boom");
    });
  });

  // The body keeps its frame, so the stack that `f` sees names the function
  // that contains the `return f()`.
  describe("`return f()` keeps the frame of the body", () => {
    // The name of the function that called the function that called this one.
    function callerName() {
      const frame = new Error().stack!.split("\n")[2] ?? "no frame";
      return /^\s*at (?:async )?(\S+) \(/.exec(frame)?.[1] ?? frame;
    }

    test("generator body", () => {
      function* generatorBody() {
        return callerName();
      }
      expect(generatorBody().next().value).toBe("generatorBody");
    });

    test("async function body", async () => {
      async function asyncFunctionBody() {
        await 0;
        return callerName();
      }
      expect(await asyncFunctionBody()).toBe("asyncFunctionBody");
    });

    test("async generator body", async () => {
      async function* asyncGeneratorBody() {
        return callerName();
      }
      expect((await asyncGeneratorBody().next()).value).toBe("asyncGeneratorBody");
    });

    test("async arrow body", async () => {
      // The body of an async arrow has no name. `frameCount() + 0` is not a
      // tail call in either engine, so both bodies see the same number of frames.
      const frameCount = () => new Error().stack!.split("\n").length;
      const returnsCall = async () => {
        await 0;
        return frameCount();
      };
      const returnsSum = async () => {
        await 0;
        return frameCount() + 0;
      };
      expect(await returnsCall()).toBe(await returnsSum());
    });

    test("an error that an async function returns after an await has a stack", async () => {
      // The runtime transpiler prints `new Error(m)` as `Error(m)`. As a tail
      // call from a resumed body it ran with no JavaScript frame left on the
      // stack, and `stack` was undefined.
      async function loadUser(id: number) {
        await 0;
        return new Error("no user " + id);
      }
      expect((await loadUser(1)).stack).toContain("at loadUser (");
    });

    test("Error.captureStackTrace(error, helper) keeps the async caller of the helper", async () => {
      function fail(message: string) {
        const error = new Error(message);
        Error.captureStackTrace(error, fail);
        return error;
      }
      async function validate(input: unknown) {
        if (!input) return fail("invalid");
        await 0;
      }
      expect((await validate(0))!.stack).toContain("at validate (");
    });
  });
});
