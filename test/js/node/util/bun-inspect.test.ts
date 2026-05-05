import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import stripAnsi from "strip-ansi";

describe("Bun.inspect", () => {
  it("reports error instead of [native code]", () => {
    expect(() =>
      Bun.inspect({
        [Symbol.for("nodejs.util.inspect.custom")]() {
          throw new Error("custom inspect");
        },
      }),
    ).toThrow("custom inspect");
  });

  it("supports colors: false", () => {
    const output = Bun.inspect({ a: 1 }, { colors: false });
    expect(stripAnsi(output)).toBe(output);
  });

  it("supports colors: true", () => {
    const output = Bun.inspect({ a: 1 }, { colors: true });
    expect(stripAnsi(output)).not.toBe(output);
    expect(stripAnsi(output)).toBe(Bun.inspect({ a: 1 }, { colors: false }));
  });

  it("supports colors: false, via 2nd arg", () => {
    const output = Bun.inspect({ a: 1 }, null, null);
    expect(stripAnsi(output)).toBe(output);
  });

  it("supports colors: true, via 2nd arg", () => {
    const output = Bun.inspect({ a: 1 }, true, 2);
    expect(stripAnsi(output)).not.toBe(output);
  });

  it("supports compact", () => {
    expect(Bun.inspect({ a: 1, b: 2 }, { compact: true })).toBe("{ a: 1, b: 2 }");
    expect(Bun.inspect({ a: 1, b: 2 }, { compact: false })).toBe("{\n  a: 1,\n  b: 2,\n}");

    expect(Bun.inspect({ a: { 0: 1, 1: 2 }, b: 3 }, { compact: true })).toBe('{ a: { "0": 1, "1": 2 }, b: 3 }');
    expect(Bun.inspect({ a: { 0: 1, 1: 2 }, b: 3 }, { compact: false })).toBe(
      '{\n  a: {\n    "0": 1,\n    "1": 2,\n  },\n  b: 3,\n}',
    );
  });

  it("depth < 0 throws", () => {
    expect(() => Bun.inspect({}, { depth: -1 })).toThrow();
    expect(() => Bun.inspect({}, { depth: -13210 })).toThrow();
  });
  for (let base of [new Error("hi"), { a: "hi" }]) {
    it(`depth = Infinity works for ${base.constructor.name}`, () => {
      function createRecursiveObject(n: number): any {
        if (n === 0) {
          return { a: base };
        }
        return { a: createRecursiveObject(n - 1) };
      }

      const obj = createRecursiveObject(512);
      expect(Bun.inspect(obj, { depth: Infinity })).toContain("hi");
      // this gets converted to u16, which if just truncating, will turn into 0
      expect(Bun.inspect(obj, { depth: 0x0fff0000 })).toContain("hi");
    });
  }

  it("stack overflow is thrown when it should be for objects", () => {
    var object = { a: { b: { c: { d: 1 } } } };
    for (let i = 0; i < 16 * 1024; i++) {
      object = { a: object };
    }

    expect(() => Bun.inspect(object, { depth: Infinity })).toThrowErrorMatchingInlineSnapshot(
      `"Maximum call stack size exceeded."`,
    );
  });

  it("stack overflow is thrown when it should be for Error", () => {
    var object = { a: { b: { c: { d: 1 } } } };
    for (let i = 0; i < 16 * 1024; i++) {
      const err = new Error("hello");
      err.object = object;
      object = err;
    }

    expect(() => Bun.inspect(object, { depth: Infinity })).toThrowErrorMatchingInlineSnapshot(
      `"Maximum call stack size exceeded."`,
    );
  });

  it("depth = 0", () => {
    expect(Bun.inspect({ a: { b: { c: { d: 1 } } } }, { depth: 0 })).toEqual("{\n  a: [Object ...],\n}");
  });

  // Loading node:util inside the util.inspect LazyProperty initializer can throw if user
  // code has broken globals (e.g. deleted Symbol.for). Previously this tripped a
  // RELEASE_ASSERT in JSC::LazyProperty because the initializer returned without calling
  // init.set(). It should now surface as a catchable JS error instead of aborting.
  it("lazy init failure does not crash", () => {
    const { exitCode, signalCode } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `
          delete Symbol.for;
          const bc = new BroadcastChannel("x");
          let threw = false;
          try {
            console.log(bc);
          } catch (e) {
            threw = e instanceof TypeError;
          }
          // Second attempt should not crash either (lazy slot is now permanently null).
          try { console.log(bc); } catch {}
          // And neither should the colors path which goes through utilInspectStylizeColorFunction.
          const obj = { [Bun.inspect.custom]() { return "x"; } };
          try { Bun.inspect(obj, { colors: true }); } catch {}
          try { Bun.inspect(obj, { colors: true }); } catch {}
          bc.close();
          if (!threw) throw new Error("expected TypeError");
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(signalCode).toBeUndefined();
    expect(exitCode).toBe(0);
  });
});
