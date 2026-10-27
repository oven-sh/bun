import { cc, CString, JSCallback, ptr, type FFIFunction, type Library } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  promises as fs,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, isASAN, isWindows, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";
import path from "path";

// TODO: we need to install build-essential and Apple SDK in CI.
// It can't find includes. It can on machines with that enabled.
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
it.todoIf(isWindows || isASAN)("can run a .c file", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), path.join(__dirname, "cc-fixture.js")],
    cwd: __dirname,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  expect(result.exitCode).toBe(0);
});

// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isASAN)("given an add(a, b) function", () => {
  const source = /* c */ `
      int add(int a, int b) {
        return a + b;
      }
    `;
  let dir: string;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-cc-test", {
      "add.c": source,
    });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe("when compiled", () => {
    let res: Library<{ add: { args: ["int", "int"]; returns: "int" } }>;

    beforeAll(() => {
      res = cc({
        source: path.join(dir, "add.c"),
        symbols: {
          add: {
            returns: "int",
            args: ["int", "int"],
          },
        },
      });
    });

    afterAll(() => {
      res.close();
    });

    it("provides an add symbol", () => {
      expect(res.symbols.add(1, 2)).toBe(3);
    });

    it("when passed arguments with incorrect types, throws an error", () => {
      // @ts-expect-error
      expect(() => res.symbols.add("1", "2")).toThrow("bun:ffi cannot convert argument to 'i32'");
    });

    it("when passed too many arguments, still works", () => {
      // @ts-expect-error
      expect(res.symbols.add(1, 2, 3)).toBe(3);
    });

    it("Only contains 1 symbol", () => {
      expect(Object.keys(res.symbols)).toHaveLength(1);
    });
  }); // </when compiled>

  it("when compiled with a symbol that doesn't exist, throws an error", () => {
    expect(() => {
      cc({
        source: path.join(dir, "add.c"),
        symbols: { subtract: { args: ["int", "int"], returns: "int" } },
      });
    }).toThrow(/"subtract" is missing/);
  });
}); // </given add(a, b) function>

// Runs in a subprocess because reading past the passed arguments as a pointer or napi_value can crash.
it("treats a missing argument as undefined", async () => {
  using dir = tempDir("bun-ffi-cc-short-call", {
    "short-call.c": /* c */ `
      typedef struct test_env* env_t;
      typedef struct test_value* value_t;
      int add(int a, int b) { return a + b; }
      int first_byte(int unused, const unsigned char* p) { return p ? p[0] : -1; }
      _Bool is_nan(double a, double b) { return b != b; }
      value_t echo(env_t env, value_t value) { return value; }
    `,
    "fixture.js": /* js */ `
      import { cc } from "bun:ffi";
      import path from "path";

      const { symbols } = cc({
        source: path.join(import.meta.dir, "short-call.c"),
        symbols: {
          add: { args: ["i32", "i32"], returns: "i32" },
          first_byte: { args: ["i32", "ptr"], returns: "i32" },
          is_nan: { args: ["f64", "f64"], returns: "bool" },
          echo: { args: ["napi_env", "napi_value"], returns: "napi_value" },
        },
      });
      const { add, first_byte, is_nan, echo } = symbols;
      console.log(JSON.stringify({
        add: [add(1) === add(1, undefined), add() === add(undefined, undefined), add(1, 2), add(1, 2, 3)],
        first_byte: [first_byte(), first_byte(0), first_byte.call(null, 0), first_byte(0, new Uint8Array([7]))],
        is_nan: [is_nan(), is_nan(1), is_nan(1, 2)],
        echo: [typeof echo(), typeof echo(null), echo(null, 42)],
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({
    add: [true, true, 3, 3],
    first_byte: [-1, -1, -1, 7],
    is_nan: [true, true, false],
    echo: ["undefined", "undefined", 42],
  });
  expect(exitCode).toBe(0);
});

it("the ptr of a symbol is the address of the C function", async () => {
  using dir = tempDir("bun-ffi-cc-symbol-ptr", {
    "symbols.c": /* c */ `
      int add(int a, int b) { return a + b; }
      int apply(int (*f)(int, int), int a, int b) { return f(a, b); }
    `,
    "fixture.js": /* js */ `
      import { cc, CFunction } from "bun:ffi";
      import path from "path";

      const { symbols } = cc({
        source: path.join(import.meta.dir, "symbols.c"),
        symbols: {
          add: { args: ["i32", "i32"], returns: "i32" },
          apply: { args: ["function", "i32", "i32"], returns: "i32" },
        },
      });
      console.log(JSON.stringify({
        cfunction: new CFunction({ ptr: symbols.add.ptr, args: ["i32", "i32"], returns: "i32" })(40, 2),
        argument: symbols.apply(symbols.add.ptr, 20, 22),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe('{"cfunction":42,"argument":42}\n');
  expect(exitCode).toBe(0);
});

// Runs in a subprocess because a value misread as a double becomes the pointer -1.
it("pointer and 64-bit integer arguments accept what dlopen() accepts and throw a TypeError otherwise", async () => {
  using dir = tempDir("bun-ffi-cc-fallible-args", {
    "args.c": /* c */ `
      typedef struct test_env* env_t;
      static int native_calls = 0;
      int get_native_calls(void) { return native_calls; }
      int call_callback(int (*callback)(int)) { native_calls++; return callback ? callback(21) * 2 : -1; }
      void* echo_ptr(void* p) { native_calls++; return p; }
      void* echo_cstring(const char* s) { native_calls++; return (void*)s; }
      void* echo_buffer(void* p) { native_calls++; return p; }
      long long echo_i64(long long x) { native_calls++; return x; }
      unsigned long long echo_u64(unsigned long long x) { native_calls++; return x; }
      int with_env(env_t env, void* a, long long b) { native_calls++; return env != 0 && a != 0 && b == 5; }
    `,
    "fixture.js": /* js */ `
      import { cc, JSCallback, ptr } from "bun:ffi";
      import path from "path";

      const { symbols } = cc({
        source: path.join(import.meta.dir, "args.c"),
        symbols: {
          get_native_calls: { args: [], returns: "i32" },
          call_callback: { args: ["function"], returns: "i32" },
          echo_ptr: { args: ["ptr"], returns: "ptr" },
          echo_cstring: { args: ["cstring"], returns: "ptr" },
          echo_buffer: { args: ["buffer"], returns: "ptr" },
          echo_i64: { args: ["i64"], returns: "i64" },
          echo_u64: { args: ["u64"], returns: "u64" },
          with_env: { args: ["napi_env", "ptr", "i64"], returns: "i32" },
        },
      });
      const callback = new JSCallback(x => x + 1, { args: ["i32"], returns: "i32" });
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      const address = ptr(view);

      function outcomes(name, ...inputs) {
        return inputs.map(input => {
          const before = symbols.get_native_calls();
          try {
            const result = symbols[name](...[].concat(input));
            return result === address ? "address" : String(result);
          } catch (error) {
            return error.name + (symbols.get_native_calls() === before ? "" : " after the call");
          }
        });
      }
      const object = { ptr: address };
      console.log(JSON.stringify({
        call_callback: outcomes("call_callback", callback, callback.ptr, { ptr: callback.ptr }, null, undefined, () => 1, {}, "x"),
        echo_ptr: outcomes("echo_ptr", address, 8, view, buffer, BigInt(address), { ptr: address }, null, undefined, {}, "x", true),
        echo_cstring: outcomes("echo_cstring", address, view, null, {}, "x"),
        echo_buffer: outcomes("echo_buffer", view, new DataView(buffer), buffer, address, null, {}),
        echo_i64: outcomes("echo_i64", 5, -5.5, 2 ** 40, -(2n ** 63n), undefined, null, true, "5", {}),
        echo_u64: outcomes("echo_u64", 5, 2 ** 40, 2n ** 64n - 1n, undefined, null, true, "5", {}),
        with_env: outcomes("with_env", [null, object, 5], [null, {}, 5], [null, object, "5"], [null, "x", object], [null, view, 5n]),
      }));
      callback.close();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const T = "TypeError";
  expect(JSON.parse(stdout)).toEqual({
    call_callback: ["44", "44", "44", "-1", "-1", T, T, T],
    echo_ptr: ["address", "8", "address", "address", "address", "address", "null", "null", T, T, T],
    echo_cstring: ["address", "address", "null", T, T],
    echo_buffer: ["address", "address", T, T, T, T],
    echo_i64: ["5", "-5", String(2 ** 40), String(-(2n ** 63n)), T, T, T, T, T],
    echo_u64: ["5", String(2 ** 40), String(2n ** 64n - 1n), T, T, T, T, T],
    with_env: ["1", T, T, T, "1"],
  });
  expect(exitCode).toBe(0);
});

// Each C function is called through its cc() symbol and through CFunction, which is the path dlopen() and linkSymbols() use.
// Runs in a subprocess because a double that is boxed wrongly can be read as a pointer.
it.concurrent("a symbol returns what dlopen() returns for the same C function", async () => {
  using dir = tempDir("bun-ffi-cc-returns", {
    "returns.c": /* c */ `
      typedef unsigned long long bits64;
      union caster { bits64 u; double d; float f; };
      // The integer functions return all 64 bits. The declared return type says how many of them are the value.
      bits64 r_char(bits64 v) { return v; }
      bits64 r_i8(bits64 v) { return v; }
      bits64 r_u8(bits64 v) { return v; }
      bits64 r_i16(bits64 v) { return v; }
      bits64 r_u16(bits64 v) { return v; }
      bits64 r_i32(bits64 v) { return v; }
      bits64 r_u32(bits64 v) { return v; }
      bits64 r_i64(bits64 v) { return v; }
      bits64 r_u64(bits64 v) { return v; }
      bits64 r_i64_fast(bits64 v) { return v; }
      bits64 r_u64_fast(bits64 v) { return v; }
      double r_f64(bits64 v) { union caster c; c.u = v; return c.d; }
      float r_f32(bits64 v) { union caster c; c.u = v; return c.f; }
      // A bool is 0 or 1 in the low byte.
      bits64 r_bool(bits64 v) { return (v & ~0xffULL) | ((v & 0xff) != 0); }
      bits64 r_ptr(bits64 v) { return v; }
      bits64 r_function(bits64 v) { return v; }
      bits64 r_cstring(bits64 v) { return v; }
      void r_void(bits64 v) {}
      bits64 napi_u32(void* env, bits64 v) { return v; }
      bits64 napi_i64_fast(void* env, bits64 v) { return v; }
      bits64 napi_ptr(void* env, bits64 v) { return v; }
    `,
    "fixture.js": /* js */ `
      import { cc, CFunction } from "bun:ffi";
      import { jscDescribe } from "bun:jsc";
      import path from "path";

      const types = [
        "char", "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64",
        "i64_fast", "u64_fast", "f64", "f32", "bool", "ptr", "function", "cstring", "void",
      ];
      const napiTypes = ["u32", "i64_fast", "ptr"];
      const symbols = {};
      for (const type of types) symbols["r_" + type] = { args: ["u64"], returns: type };
      for (const type of napiTypes) symbols["napi_" + type] = { args: ["napi_env", "u64"], returns: type };
      const compiled = cc({ source: path.join(import.meta.dir, "returns.c"), symbols }).symbols;

      const cases = [];
      for (const type of types) {
        // A cstring symbol decodes the string in JS. Its .native returns the address.
        const viaCompiled = type === "cstring" ? compiled.r_cstring.native : compiled["r_" + type];
        const returns = type === "cstring" ? "ptr" : type;
        cases.push([type, viaCompiled, new CFunction({ ptr: viaCompiled.ptr, args: ["u64"], returns })]);
      }
      for (const type of napiTypes) {
        const viaCompiled = compiled["napi_" + type];
        const viaEngine = new CFunction({ ptr: viaCompiled.ptr, args: ["ptr", "u64"], returns: type });
        cases.push(["napi " + type, value => viaCompiled(null, value), value => viaEngine(null, value)]);
      }

      const boundaries = [2n ** 31n - 1n, 2n ** 31n, 2n ** 32n - 1n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, 2n ** 63n, 2n ** 64n - 1n];
      const bits = [
        0n, 1n, 0x7fn, 0x80n, 0xffn, 0x100n, 0x7fffn, 0x8000n, 0xffffn, 0x10000n, 2n ** 31n + 1n, 2n ** 32n, 2n ** 53n - 2n,
        // As an int64: 2 ** 63 - 1, -(2 ** 53), -(2 ** 53 - 1), -(2 ** 31) - 1, -(2 ** 31)
        2n ** 63n - 1n, 2n ** 64n - 2n ** 53n, 2n ** 64n - 2n ** 53n + 1n, 2n ** 64n - 2n ** 31n - 1n, 2n ** 64n - 2n ** 31n,
        // 1.5, NaN and Infinity as a double; 1.5 and NaN as a float. 2 ** 63 is -0 as a double.
        0x3ff8000000000000n, 0x7ff8000000000000n, 0x7ff0000000000000n, 0x3fc00000n, 0x7fc00000n,
        ...boundaries,
      ];
      // An int32 and a double with the same value print the same. The first word of jscDescribe() tells them apart.
      // The engine boxes an f64 or f32 return in two ways, so those rows compare the value only.
      const show = (name, value) =>
        (name === "f64" || name === "f32" ? typeof value : jscDescribe(value).split(/[: ]/)[0]) +
        " " +
        (Object.is(value, -0) ? "-0" : String(value));
      let calls = 0;
      const differences = [];
      for (const [name, viaCompiled, viaEngine] of cases) {
        for (const value of bits) {
          calls++;
          const fromCompiled = viaCompiled(value);
          const fromEngine = viaEngine(value);
          // === is false for two equal int32s when the tag bits of one are wrong.
          const same =
            show(name, fromCompiled) === show(name, fromEngine) &&
            (fromCompiled === fromEngine || fromCompiled !== fromCompiled);
          if (!same) {
            differences.push(
              name + " 0x" + value.toString(16) + ": cc() " + show(name, fromCompiled) + ", dlopen() " + show(name, fromEngine),
            );
          }
        }
      }

      const table = type => boundaries.map(value => {
        const result = compiled["r_" + type](value);
        return typeof result === "bigint" ? result + "n" : result;
      });
      console.log(JSON.stringify({
        calls,
        differences,
        u32: table("u32"),
        i64_fast: table("i64_fast"),
        ptr: table("ptr"),
        function: table("function"),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const pointers = [
    2147483647,
    2147483648,
    4294967295,
    9007199254740991,
    "9007199254740992n",
    "9007199254740993n",
    "9223372036854775808n",
    "18446744073709551615n",
  ];
  expect(JSON.parse(stdout)).toEqual({
    calls: 21 * 31,
    differences: [],
    // 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 1, 2 ** 63, 2 ** 64 - 1
    u32: [2147483647, 2147483648, 4294967295, 4294967295, 0, 1, 0, 4294967295],
    i64_fast: [
      2147483647,
      2147483648,
      4294967295,
      9007199254740991,
      "9007199254740992n",
      "9007199254740993n",
      "-9223372036854775808n",
      -1,
    ],
    ptr: pointers,
    function: pointers,
  });
  expect(exitCode).toBe(0);
});

// Each C function is called through its cc() symbol and through CFunction, which is the path dlopen() and linkSymbols() use.
it.concurrent("an argument reaches C as it does through dlopen()", async () => {
  using dir = tempDir("bun-ffi-cc-args", {
    "args.c": /* c */ `
      static int native_calls = 0;
      int get_native_calls(void) { return native_calls; }
      union caster { long long bits; double d; float f; };
      // Each a_ function returns the value that C received.
      long long a_char(char x) { native_calls++; return x; }
      long long a_i8(signed char x) { native_calls++; return x; }
      long long a_u8(unsigned char x) { native_calls++; return x; }
      long long a_i16(short x) { native_calls++; return x; }
      long long a_u16(unsigned short x) { native_calls++; return x; }
      long long a_i32(int x) { native_calls++; return x; }
      long long a_u32(unsigned int x) { native_calls++; return x; }
      long long a_bool(_Bool x) { native_calls++; return x; }
      // These two return the bits of the float or double.
      long long a_f32(float x) { native_calls++; union caster c; c.bits = 0; c.f = x; return c.bits; }
      long long a_f64(double x) { native_calls++; union caster c; c.d = x; return c.bits; }
      unsigned long long a_i64(long long x) { native_calls++; return x; }
      unsigned long long a_u64(unsigned long long x) { native_calls++; return x; }
      unsigned long long a_i64_fast(long long x) { native_calls++; return x; }
      unsigned long long a_u64_fast(unsigned long long x) { native_calls++; return x; }
      unsigned long long a_ptr(void* x) { native_calls++; return (unsigned long long)x; }
      unsigned long long a_cstring(void* x) { native_calls++; return (unsigned long long)x; }
      unsigned long long a_function(void* x) { native_calls++; return (unsigned long long)x; }
      unsigned int r_u32(unsigned long long v) { return (unsigned int)v; }
      // One digit per argument.
      double mixed(_Bool a, void* b, float c, long long d, int e, double f) {
        native_calls++;
        return a * 100000 + (long long)b * 10000 + c * 1000 + d * 100 + e * 10 + f;
      }
    `,
    "fixture.js": /* js */ `
      import { cc, CFunction } from "bun:ffi";
      import { jscDescribe } from "bun:jsc";
      import path from "path";

      // dlopen() converts an object to one of these with valueOf(). A cc() wrapper holds pointers into earlier arguments,
      // so it cannot run JS, and throws.
      const numbers = ["char", "i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"];
      const wide = ["i64", "u64", "i64_fast", "u64_fast", "ptr", "cstring", "function"];
      const types = [...numbers, "bool", ...wide];
      const symbols = { get_native_calls: { args: [], returns: "i32" }, r_u32: { args: ["u64"], returns: "u32" } };
      for (const type of types) symbols["a_" + type] = { args: [type], returns: wide.includes(type) ? "u64" : "i64" };
      const mixed = { args: ["bool", "ptr", "f32", "i64", "i32", "f64"], returns: "f64" };
      symbols.mixed = mixed;
      const compiled = cc({ source: path.join(import.meta.dir, "args.c"), symbols }).symbols;

      // https://github.com/oven-sh/bun/issues/44906: an element of a Float64Array is a double, also when its value is an integer.
      const fromFloat64Array = [...new Float64Array([7, 3, 0, -5, 1e6])];
      const values = [
        0, 1, -1, 127, 128, 255, 256, 32767, 32768, 65535, 65536, 2 ** 24 + 1, 2 ** 31 - 1, -(2 ** 31),
        0.5, -0.5, 5.7, -5.7, -0, 2 ** 31, 2 ** 32 - 1, 2 ** 32 + 5, -(2 ** 31) - 1, 2 ** 53, 1e19, -1e19, 1e300,
        NaN, Infinity, -Infinity,
        ...fromFloat64Array,
        undefined, null, true, false,
        0n, 5n, -5n, 2n ** 31n, 2n ** 64n - 1n, 2n ** 64n + 7n, 2n ** 1024n,
        "", "5", Symbol("s"),
      ];
      const objects = [{}, [5], new Number(5), { valueOf: () => 5 }];
      const outcome = (fn, value) => {
        const before = compiled.get_native_calls();
        try {
          return String(fn(value));
        } catch (error) {
          return error.name + (compiled.get_native_calls() === before ? "" : " after the call");
        }
      };
      const show = value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value));

      // Where cc() keeps its own result. The test pins each one.
      const keeps = (type, value) => {
        const isPointer = type === "ptr" || type === "cstring" || type === "function";
        // From 2 ** 64 a u64 is all ones, and dlopen() wraps. From 2 ** 63 a pointer is the number up to all ones,
        // and the CPU decides what dlopen() passes.
        if (typeof value === "number") return (type.startsWith("u64") && value >= 2 ** 64) || (isPointer && value >= 2 ** 63);
        // cc() passes NULL. dlopen() throws.
        if (value == null) return type === "function";
        // dlopen() passes a copy of the string in UTF-8, which cc() could not free. cc() throws.
        return typeof value === "string" && type === "cstring";
      };

      let calls = 0;
      const differences = [];
      const kept = {};
      const objectOutcomes = new Set();
      for (const type of types) {
        const viaCompiled = compiled["a_" + type];
        const viaEngine = new CFunction({ ptr: viaCompiled.ptr, ...symbols["a_" + type] });
        for (const value of numbers.includes(type) ? values : [...values, ...objects]) {
          const fromCompiled = outcome(viaCompiled, value);
          if (keeps(type, value)) {
            kept[type + " " + show(value)] = fromCompiled;
            continue;
          }
          calls++;
          const fromEngine = outcome(viaEngine, value);
          if (fromCompiled !== fromEngine) {
            differences.push(type + " " + show(value) + ": cc() " + fromCompiled + ", dlopen() " + fromEngine);
          }
        }
        if (numbers.includes(type)) for (const object of objects) objectOutcomes.add(outcome(viaCompiled, object));
      }

      // The wrapper converts every argument before the call, each in its own way.
      const mixedViaEngine = new CFunction({ ptr: compiled.mixed.ptr, ...mixed });
      const mixedArguments = [
        [true, 2, 3, 4, 5, 6],
        [1, 2n, 3n, 4n, fromFloat64Array[0], null],
        ["x", 2, 3, 4, 5, 6],
        [true, "2", 3, 4, 5, 6],
        [true, 2, "3", 4, 5, 6],
        [true, 2, 3, "4", 5, 6],
        [true, 2, 3, 4, "5", 6],
        [true, 2, 3, 4, 5, "6"],
      ];
      const mixedOutcomes = mixedArguments.map(args => {
        calls++;
        const fromCompiled = outcome(value => compiled.mixed(...value), args);
        const fromEngine = outcome(value => mixedViaEngine(...value), args);
        if (fromCompiled !== fromEngine) {
          differences.push("mixed " + args.map(show) + ": cc() " + fromCompiled + ", dlopen() " + fromEngine);
        }
        return fromCompiled;
      });

      console.log(JSON.stringify({
        calls,
        differences,
        objects: [...objectOutcomes],
        fromFloat64Array: {
          kinds: fromFloat64Array.map(value => jscDescribe(value).split(/[: ]/)[0]),
          i32: fromFloat64Array.map(value => Number(compiled.a_i32(value))),
          u32: fromFloat64Array.map(value => Number(compiled.a_u32(value))),
          i16: fromFloat64Array.map(value => Number(compiled.a_i16(value))),
        },
        // A u32 return of 2 ** 31 is a double.
        returnedU32: Number(compiled.a_u32(compiled.r_u32(2n ** 31n))),
        bool: [true, false, 1, 0, -1, 0.5, NaN, "x", "", null, undefined, 5n, 0n, {}].map(value =>
          Number(compiled.a_bool(value)),
        ),
        f64: [5, 1.5, 5n, true, null].map(value => compiled.a_f64(value).toString(16)),
        // -5 as an int32 and as a double.
        negative: ["u64", "ptr"].map(type => [-5, fromFloat64Array[3]].map(value => compiled["a_" + type](value).toString(16))),
        mixed: mixedOutcomes,
        kept,
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const allOnes = "18446744073709551615";
  expect(JSON.parse(stdout)).toEqual({
    // 9 number types with 49 values. 8 other types with these and 4 objects. 8 calls of mixed().
    calls: 9 * 49 + 8 * 53 - 17 + 8,
    differences: [],
    objects: ["TypeError"],
    fromFloat64Array: {
      kinds: ["Double", "Double", "Double", "Double", "Double"],
      i32: [7, 3, 0, -5, 1000000],
      u32: [7, 3, 0, 4294967291, 1000000],
      i16: [7, 3, 0, -5, 16960],
    },
    returnedU32: 2147483648,
    bool: [1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1],
    // The bits of 5, 1.5, 5, 1 and 0 as a double.
    f64: ["4014000000000000", "3ff8000000000000", "4014000000000000", "3ff0000000000000", "0"],
    negative: [
      ["fffffffffffffffb", "fffffffffffffffb"],
      ["fffffffffffffffb", "fffffffffffffffb"],
    ],
    // A string is true as a bool. It throws for every other type, before the call.
    mixed: ["123456", "123470", "123456", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError"],
    kept: {
      "u64 1e+300": allOnes,
      "u64 Infinity": allOnes,
      "u64_fast 1e+300": allOnes,
      "u64_fast Infinity": allOnes,
      "ptr 10000000000000000000": "10000000000000000000",
      "ptr 1e+300": allOnes,
      "ptr Infinity": allOnes,
      "cstring 10000000000000000000": "10000000000000000000",
      "cstring 1e+300": allOnes,
      "cstring Infinity": allOnes,
      "cstring ": "TypeError",
      "cstring 5": "TypeError",
      "function 10000000000000000000": "10000000000000000000",
      "function 1e+300": allOnes,
      "function Infinity": allOnes,
      "function undefined": "0",
      "function null": "0",
    },
  });
  expect(exitCode).toBe(0);
});

it("does not run a \`ptr\` getter, which could detach the buffer of an earlier argument", () => {
  using dir = tempDir("bun-ffi-cc-ptr-getter", {
    "echo.c": "void* echo_first(void* first, void* second) { return first; }",
  });
  const library = cc({
    source: path.join(String(dir), "echo.c"),
    symbols: { echo_first: { args: ["ptr", "ptr"], returns: "ptr" } },
  });
  const buffer = new ArrayBuffer(8);
  const detaches = {
    get ptr() {
      buffer.transfer();
      return 0;
    },
  };
  try {
    expect(() => library.symbols.echo_first(new Uint8Array(buffer), detaches)).toThrow(
      "bun:ffi cannot convert argument to 'ptr'",
    );
    expect(buffer.detached).toBe(false);
  } finally {
    library.close();
  }
});

it("throws for an empty source array", () => {
  expect(() => cc({ source: [] as any, symbols: { add: { args: ["int", "int"], returns: "int" } } })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      message: 'The "source" argument must have at least one file. Received an instance of Array',
    }),
  );
});

describe("given a source file with syntax errors", () => {
  const source = /* c */ `
    int add(int a, int b) {
      return a  b;
    }
  `;
  let dir: string;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-cc-test", {
      "add.c": source,
    });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // FIXME: fails asan poisoning check
  // TinyCC uses `setjmp` on an internal error handler, then jumps there when it
  // encounters a syntax error. Newer versions of tcc added a public API to
  // set a runtime error handler, but we need to upgrade in order to get it.
  // https://github.com/TinyCC/tinycc/blob/f8bd136d198bdafe71342517fa325da2e243dc68/libtcc.h#L106C9-L106C24
  it.skip("when compiled, throws an error", () => {
    expect(() => {
      cc({
        source: path.join(dir, "add.c"),
        symbols: {
          add: {
            returns: "int",
            args: ["int", "int"],
          },
        },
      });
    }).toThrow();
  });
});

// cc() wraps a symbol that returns a cstring in a closure, not in script made from a string.
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isASAN)("given a symbol that returns a cstring", () => {
  for (const flag of ["--disallow-code-generation-from-strings", "--disallow-code-generation-from-strings=strict"]) {
    it(`is called with ${flag}`, async () => {
      using dir = tempDir("bun-ffi-cc-cstring", {
        "hello.c": /* c */ `const char* hello(int n) { return n ? "hello from c" : 0; }`,
        "index.js": /* js */ `
          const { cc } = require("bun:ffi");
          const { symbols, close } = cc({
            source: require("path").join(__dirname, "hello.c"),
            symbols: { hello: { args: ["int"], returns: "cstring" } },
          });
          console.log(JSON.stringify([String(symbols.hello(1)), symbols.hello(0), typeof symbols.hello.native]));
          close();
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), flag, "index.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout)).toEqual(["hello from c", null, "function"]);
      expect(exitCode).toBe(0);
    });
  }
});

describe.skip("given a ping(cstr) function", () => {
  const library = makeValidCase(
    "ping",
    /* c */ `
    char* ping(char* str) {
      return str;
    }
  `,
    {
      ping: {
        args: ["cstring"],
        returns: "cstring",
      },
    },
  );

  it("given a valid CString, returns the same pointer", () => {
    const buf = Buffer.from("hello\0");
    const arr = new Uint8Array(buf);
    const cstr = new CString(ptr(arr));

    expect(library.symbols.ping(cstr)).toBe(cstr);
  });
}); // </given a ping(cstr) function>

// FIXME: bus error
describe.skip("given a strlen(cstring) function", () => {
  const library = makeValidCase(
    "strlen",
    /* c */ `
      size_t strlen(char* str) {
        char* s = str;
        while (*s) s++;
        return s - str;
      }
    `,
    {
      strlen: {
        args: ["cstring"],
        returns: "usize",
      },
    },
  );

  it("given a valid CString containing 'hello', returns the correct length", () => {
    const buf = Buffer.from("hello\0");
    const arr = new Uint8Array(buf);
    const cstr = new CString(ptr(arr));

    expect<number | bigint>(library.symbols.strlen(cstr)).toBe(5);
  });

  it("given a JSString, throws", () => {
    expect(() => library.symbols.strlen("hello")).toThrow(TypeError);
  });
}); // </given a strlen(cstring) function>

// =============================================================================

function makeValidCase<Fns extends Record<string, FFIFunction>>(
  name: string,
  source: string,
  symbols: Fns,
): Library<Fns> {
  const filename = `${name}.c`;

  var library: Library<Fns>;

  beforeAll(() => {
    try {
      var dir = tempDirWithFiles(`bun-ffi-cc-${name}`, {
        [filename]: source,
      });

      library = cc({
        source: path.join(dir, filename),
        symbols,
      });
    } finally {
      // @ts-ignore -- `var` gets hoisted
      if (dir) fs.rm(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    library.close();
  });

  // @ts-ignore
  return library;
}

// =============================================================================

// The fixture needs pthread_create/pthread_join resolved against the host
// process, which TinyCC's in-memory output only supports on POSIX.
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isWindows || isASAN)("threadsafe JSCallback invoked from a foreign thread", () => {
  // TinyCC only ships its own builtin headers, so we cannot #include
  // <pthread.h>. pthread_t is `unsigned long` on glibc and a pointer on
  // macOS/musl; both fit in 8 bytes.
  const source = /* c */ `
    typedef unsigned long bun_test_pthread_t;
    extern int pthread_create(bun_test_pthread_t*, const void*, void* (*)(void*), void*);
    extern int pthread_join(bun_test_pthread_t, void**);

    typedef void (*bun_test_callback)(int);

    static bun_test_pthread_t bun_test_thread;
    static bun_test_callback bun_test_cb;
    static int bun_test_count;

    static void* bun_test_thread_main(void* arg) {
      for (int i = 0; i < bun_test_count; i++) {
        bun_test_cb(i);
      }
      return 0;
    }

    int start(void* cb, int n) {
      bun_test_cb = (bun_test_callback)cb;
      bun_test_count = n;
      return pthread_create(&bun_test_thread, 0, bun_test_thread_main, 0);
    }

    int join_thread(void) {
      return pthread_join(bun_test_thread, 0);
    }

    int enqueue_n(void* cb, int n) {
      bun_test_cb = (bun_test_callback)cb;
      bun_test_count = n;
      if (pthread_create(&bun_test_thread, 0, bun_test_thread_main, 0) != 0) {
        return 1;
      }
      return pthread_join(bun_test_thread, 0);
    }
  `;
  let dir: string;
  let library: Library<{
    start: { args: ["ptr", "int"]; returns: "int" };
    join_thread: { args: []; returns: "int" };
    enqueue_n: { args: ["ptr", "int"]; returns: "int" };
  }>;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-cc-threadsafe", {
      "threadsafe-callback.c": source,
      // Test B fixture: enqueue invocations from a foreign thread, close the
      // callback while they are still queued, then wait for all of them to be
      // delivered anyway.
      "close-while-enqueued.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import source from "./threadsafe-callback.c" with { type: "file" };

        const N = 50;
        const { symbols } = cc({
          source,
          symbols: {
            enqueue_n: { args: ["ptr", "int"], returns: "int" },
          },
        });

        let count = 0;
        const cb = new JSCallback(
          () => {
            count++;
          },
          { args: ["int"], threadsafe: true },
        );

        // enqueue_n joins the worker thread before returning, so all N tasks
        // are sitting in the event-loop queue and none have run yet.
        if (symbols.enqueue_n(cb.ptr, N) !== 0) {
          throw new Error("enqueue_n failed");
        }
        cb.close();

        while (count < N) {
          await new Promise(r => setImmediate(r));
        }
        console.log("ok");
      `,
    });
    library = cc({
      source: path.join(dir, "threadsafe-callback.c"),
      symbols: {
        start: { args: ["ptr", "int"], returns: "int" },
        join_thread: { args: [], returns: "int" },
        enqueue_n: { args: ["ptr", "int"], returns: "int" },
      },
    });
  });

  afterAll(async () => {
    library?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("delivers all callbacks invoked from a foreign thread while the JS thread churns GC handles", async () => {
    const N = 200;
    const received = new Set<number>();
    const { promise, resolve } = Promise.withResolvers<void>();

    const cb = new JSCallback(
      (value: number) => {
        received.add(value);
        if (received.size === N) {
          resolve();
        }
      },
      { args: ["int"], threadsafe: true },
    );

    expect(library.symbols.start(cb.ptr, N)).toBe(0);

    // Churn JS-thread GC handle allocation while the foreign thread is
    // invoking the callback. Each iteration allocates and frees Strong
    // handles from the same HandleSet the foreign thread used to race with.
    // The setImmediate yield is required: the foreign thread's invocations
    // arrive as concurrent event-loop tasks and are only drained on
    // event-loop ticks.
    let done = false;
    promise.then(() => {
      done = true;
    });
    while (!done) {
      const tmp = new JSCallback(() => {}, { returns: "void" });
      tmp.close();
      await new Promise(r => setImmediate(r));
    }

    expect(library.symbols.join_thread()).toBe(0);
    expect([...received].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i));
    cb.close();
  });

  it("close() with foreign-thread invocations still enqueued delivers the pending invocations", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "close-while-enqueued.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });
});

// Pins GC liveness: compiled trampolines survive the library wrapper being
// collected, and a JSCallback's closure stays alive until close().
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isASAN)("GC liveness of compiled symbols and callbacks", () => {
  it("keeps symbol functions and callback closures alive across forced GC", async () => {
    using dir = tempDir("bun-ffi-cc-gc-liveness", {
      "lib.c": /* c */ `
        int twice(int x) { return x + x; }
        int invoke(int (*cb)(int), int value) { return cb(value); }
      `,
      "fixture.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import path from "path";

        function makeSymbols() {
          // Only the bound functions escape; the library wrapper becomes collectible.
          const { symbols } = cc({
            source: path.join(import.meta.dir, "lib.c"),
            symbols: {
              twice: { args: ["int"], returns: "int" },
              invoke: { args: ["ptr", "int"], returns: "int" },
            },
          });
          return [symbols.twice, symbols.invoke];
        }

        function makeCallback() {
          // Closure has no reference outside the JSCallback.
          return new JSCallback(x => x * 3, { args: ["int"], returns: "int" });
        }

        const [twice, invoke] = makeSymbols();
        const cb = makeCallback();
        let total = 0;
        for (let i = 0; i < 100; i++) {
          Bun.gc(true);
          const doubled = twice(21);
          if (doubled !== 42) {
            throw new Error("twice() returned " + doubled + " at iteration " + i);
          }
          const tripled = invoke(cb.ptr, i);
          if (tripled !== i * 3) {
            throw new Error("callback returned " + tripled + " at iteration " + i);
          }
          total++;
        }
        cb.close();
        console.log("OK " + total);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    expect({ stdout: normalizeBunSnapshot(stdout), stderr, exitCode }).toMatchObject({
      stdout: "OK 100",
      exitCode: 0,
    });
  });
});

describe.concurrent("close()", () => {
  const closed = (name: string) => `TypeError: bun:ffi: cannot call '${name}' because its library was closed`;

  // fixture.js prints `results` as JSON.
  async function run(c: string, js: string) {
    using dir = tempDir("bun-ffi-cc-close", {
      "lib.c": c,
      "fixture.js": `
        import { cc, JSCallback } from "bun:ffi";
        import path from "path";
        const open = symbols => cc({ source: path.join(import.meta.dir, "lib.c"), symbols });
        const attempt = fn => {
          try {
            return fn();
          } catch (e) {
            return e.name + ": " + e.message;
          }
        };
        const results = {};
        ${js}
        console.log(JSON.stringify(results));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { results: stdout.startsWith("{") ? JSON.parse(stdout) : stdout, stderr, exitCode };
  }

  it("throws a TypeError when a symbol is called after its library's close()", async () => {
    const c = `
      int add(int a, int b) { return a + b; }
      int answer(void) { return 42; }
    `;
    const js = `
      const symbols = { add: { args: ["int", "int"], returns: "int" }, answer: { args: [], returns: "int" } };
      const lib = open(symbols);
      const other = open(symbols);
      const { add, answer } = lib.symbols;
      results.open = [add(40, 2), answer()];
      // close() must not depend on the current contents of \`symbols\`.
      delete lib.symbols.answer;
      lib.close();
      results.closed = [attempt(() => add(40, 2)), attempt(() => answer())];
      results.other = other.symbols.add(40, 2);
    `;
    expect(await run(c, js)).toMatchObject({
      results: { open: [42, 42], closed: [closed("add"), closed("answer")], other: 42 },
      exitCode: 0,
    });
  });

  it("lets the C call finish when a JSCallback it invokes calls close()", async () => {
    const c = `
      typedef int (*callback_t)(int);
      int invoke(callback_t callback, int value) { return callback(value) + 1; }
    `;
    const js = `
      const lib = open({ invoke: { args: ["ptr", "int"], returns: "int" } });
      const { invoke } = lib.symbols;
      const callback = new JSCallback(
        value => {
          lib.close();
          return value * 2;
        },
        { args: ["int"], returns: "int" },
      );
      results.closing = invoke(callback.ptr, 20);
      results.next = attempt(() => invoke(callback.ptr, 20));
      callback.close();
    `;
    expect(await run(c, js)).toMatchObject({ results: { closing: 41, next: closed("invoke") }, exitCode: 0 });
  });

  // cc()-compiled C resolves napi_* from the host process, which is only tested on POSIX (see cc-fixture.c).
  it.skipIf(isWindows)("callbacks that the C code registered with Node-API still work after close()", async () => {
    const c = `
      typedef struct napi_env_fake* napi_env_t;
      typedef struct napi_value_fake* napi_value_t;
      typedef napi_value_t (*napi_callback_t)(napi_env_t env, void* info);
      extern int napi_create_function(napi_env_t env, const char* name, unsigned long length, napi_callback_t cb, void* data, napi_value_t* result);
      extern int napi_create_int32(napi_env_t env, int value, napi_value_t* result);
      extern int napi_add_env_cleanup_hook(napi_env_t env, void (*hook)(void* arg), void* arg);
      extern long write(int fd, const void* buf, unsigned long count);

      static napi_value_t seven(napi_env_t env, void* info) {
        napi_value_t result;
        napi_create_int32(env, 7, &result);
        return result;
      }
      static void on_exit_hook(void* arg) {
        write(2, "cleanup hook ran\\n", 17);
      }
      napi_value_t make_function(napi_env_t env) {
        napi_value_t result;
        napi_add_env_cleanup_hook(env, on_exit_hook, 0);
        napi_create_function(env, "seven", 5, seven, 0, &result);
        return result;
      }
    `;
    const js = `
      const lib = open({ make_function: { args: ["napi_env"], returns: "napi_value" } });
      const { make_function } = lib.symbols;
      const seven = make_function();
      lib.close();
      results.symbol = attempt(() => make_function());
      results.seven = seven();
    `;
    const { stderr, ...rest } = await run(c, js);
    expect({ ...rest, hookRan: stderr.includes("cleanup hook ran\n") }).toEqual({
      results: { symbol: closed("make_function"), seven: 7 },
      exitCode: 0,
      hookRan: true,
    });
  });
});

describe.skipIf(isASAN)("variadic functions inside cc()-compiled C", () => {
  it("va_arg over ints, doubles, and the stack overflow area", async () => {
    using dir = tempDir("bun-ffi-cc-varargs", {
      "varargs.c": /* c */ `
        #include <stdarg.h>

        static long long sum_ints(int count, ...) {
          va_list ap;
          va_start(ap, count);
          long long total = 0;
          for (int i = 0; i < count; i++) total += va_arg(ap, int);
          va_end(ap);
          return total;
        }

        static double sum_doubles(int count, ...) {
          va_list ap;
          va_start(ap, count);
          double total = 0;
          for (int i = 0; i < count; i++) total += va_arg(ap, double);
          va_end(ap);
          return total;
        }

        /* alternating int/double reads from one va_list: gp_offset and
           fp_offset must advance independently */
        static double sum_pairs(int count, ...) {
          va_list ap;
          va_start(ap, count);
          double total = 0;
          for (int i = 0; i < count; i++) {
            total += va_arg(ap, int);
            total += va_arg(ap, double);
          }
          va_end(ap);
          return total;
        }

        /* a 16-byte all-double struct occupies two SSE register save slots */
        struct dd { double a, b; };
        static double sum_dd(int count, ...) {
          va_list ap;
          va_start(ap, count);
          double total = 0;
          for (int i = 0; i < count; i++) {
            struct dd v = va_arg(ap, struct dd);
            total += v.a + v.b;
          }
          va_end(ap);
          return total;
        }

        /* 10 ints: exhausts the 6 integer registers and spills to the stack. */
        long long ten_ints(void) { return sum_ints(10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10); }
        /* 10 doubles: exhausts the 8 SSE registers and spills to the stack. */
        double ten_doubles(void) { return sum_doubles(10, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5); }
        double interleaved(void) { return sum_pairs(9, 1,0.5, 2,0.5, 3,0.5, 4,0.5, 5,0.5, 6,0.5, 7,0.5, 8,0.5, 9,0.5); }
        double double_pairs(void) {
          struct dd x = { 1.5, 2.5 }, y = { 3.0, 4.0 };
          return sum_dd(2, x, y);
        }
      `,
      "fixture.js": /* js */ `
        import { cc } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "varargs.c"),
          symbols: {
            ten_ints: { args: [], returns: "i64" },
            ten_doubles: { args: [], returns: "f64" },
            interleaved: { args: [], returns: "f64" },
            double_pairs: { args: [], returns: "f64" },
          },
        });
        console.log(
          JSON.stringify({
            ten_ints: Number(symbols.ten_ints()),
            ten_doubles: symbols.ten_doubles(),
            interleaved: symbols.interleaved(),
            double_pairs: symbols.double_pairs(),
          }),
        );
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        ten_ints: 55,
        ten_doubles: 50,
        interleaved: 49.5,
        double_pairs: 11,
      },
      exitCode: 0,
    });
  });
});

// long double is 16 bytes on x86_64 and always va_arg'd through the stack; on
// aarch64 it is binary128 and its arithmetic needs soft-float helpers
// (__addtf3, ...) that Bun's TCC states do not provide, so x64 only.
describe.skipIf(isASAN || process.arch !== "x64")("long double varargs inside cc()-compiled C", () => {
  it("va_arg over long double", async () => {
    using dir = tempDir("bun-ffi-cc-varargs-ld", {
      "ld.c": /* c */ `
        #include <stdarg.h>

        static double sum_long_doubles(int count, ...) {
          va_list ap;
          va_start(ap, count);
          long double total = 0;
          for (int i = 0; i < count; i++) total += va_arg(ap, long double);
          va_end(ap);
          return (double)total;
        }

        double long_doubles(void) { return sum_long_doubles(3, 1.5L, 2.25L, 3.25L); }
      `,
      "fixture.js": /* js */ `
        import { cc } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "ld.c"),
          symbols: { long_doubles: { args: [], returns: "f64" } },
        });
        console.log(JSON.stringify({ long_doubles: symbols.long_doubles() }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: { long_doubles: 7 },
      exitCode: 0,
    });
  });
});

// TinyCC emits Local-Exec TLS, which has no PT_TLS segment to target under
// in-memory relocation and would alias the host's own thread block; it must be
// rejected up front instead of silently corrupting Bun's thread-locals.
describe.skipIf(isASAN)("thread-local storage inside cc()-compiled C", () => {
  it.each([
    ["_Thread_local", " = 0"],
    ["__thread", " = 0"],
    // No initializer: lands in .tbss, so the guard's tbss/SHF_TLS arm is covered too.
    ["_Thread_local", ""],
    ["__thread", ""],
  ])("%s int x%s; is a compile error", (keyword, init) => {
    using dir = tempDir("bun-ffi-cc-tls", {
      "tls.c": `${keyword} int bun_test_tls_counter${init};\nint bump(void) { return ++bun_test_tls_counter; }\n`,
    });
    expect(() => {
      cc({
        source: path.join(String(dir), "tls.c"),
        symbols: { bump: { args: [], returns: "int" } },
      });
    }).toThrow(/thread-local storage is not supported/);
  });
});

describe("double <-> JSValue conversions", () => {
  // JSC NaN-boxes doubles, so a NaN whose payload collides with the tag space
  // ("impure NaN", see JSC's PureNaN.h) must never be encoded as-is: it would
  // decode as a native-chosen JSValue (true, undefined, an Int32, or a cell
  // pointer). Every native -> JS double boundary has to purify first.
  // All scenarios run in one spawned fixture: a forged cell-pointer JSValue
  // can crash the process, which must not take the test runner with it.
  it("impure NaNs are purified: f64/f32 returns, JSCallback arguments, read.f64/f32", async () => {
    using dir = tempDir("bun-ffi-impure-nan", {
      "impure.c": /* c */ `
        typedef unsigned long long bits64;
        union caster { bits64 u; double d; float f; };

        /* 0xfffe000000000007 + DoubleEncodeOffset(2^49) == 0x7 == JSValue(true) */
        double forge_true(void) { union caster c; c.u = 0xfffe000000000007ULL; return c.d; }
        /* 0xfffe00000000000a encodes to 0xa == JSValue(undefined) */
        double forge_undefined(void) { union caster c; c.u = 0xfffe00000000000aULL; return c.d; }
        /* 0xfffc...: encoded value lands in the Int32 tag range, reads back as 0x12345678 */
        double forge_int32(void) { union caster c; c.u = 0xfffc000012345678ULL; return c.d; }
        /* 0xfffe000012345678: encodes to a cell pointer 0x12345678 */
        double forge_cell(void) { union caster c; c.u = 0xfffe000012345678ULL; return c.d; }
        /* float NaN with a full payload widens to an impure double NaN */
        float forge_f32(void) { union caster c; c.u = 0xffffffffULL; return c.f; }
        /* the canonical quiet NaN and ordinary values must be unaffected */
        double pure_nan(void) { union caster c; c.u = 0x7ff8000000000000ULL; return c.d; }
        double normal_double(void) { return 1.5; }
        double echo_f64(double x) { return x; }

        typedef double (*js_cb)(double);
        /* the JSCallback argument direction uses the same NaN-boxing */
        double invoke_with_impure(js_cb cb) {
          union caster c; c.u = 0xfffe000000000007ULL;
          return cb(c.d);
        }
      `,
      "fixture.js": /* js */ `
        import { cc, ptr, read, JSCallback } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "impure.c"),
          symbols: {
            forge_true: { args: [], returns: "f64" },
            forge_undefined: { args: [], returns: "f64" },
            forge_int32: { args: [], returns: "f64" },
            forge_cell: { args: [], returns: "f64" },
            forge_f32: { args: [], returns: "f32" },
            pure_nan: { args: [], returns: "f64" },
            normal_double: { args: [], returns: "f64" },
            echo_f64: { args: ["f64"], returns: "f64" },
            invoke_with_impure: { args: ["ptr"], returns: "f64" },
          },
        });

        const show = value => [typeof value, String(value)];
        const results = {};
        for (const name of [
          "forge_true",
          "forge_undefined",
          "forge_int32",
          "forge_cell",
          "forge_f32",
          "pure_nan",
          "normal_double",
        ]) {
          results[name] = show(symbols[name]());
        }
        results.echo_f64 = show(symbols.echo_f64(2.5));

        let callbackArg = null;
        const callback = new JSCallback(
          x => {
            callbackArg = show(x);
            return 0;
          },
          { args: ["f64"], returns: "f64" },
        );
        results.callback_return = show(symbols.invoke_with_impure(callback.ptr));
        results.callback_arg = callbackArg;
        callback.close();

        results.read_f64 = show(read.f64(ptr(new BigUint64Array([0xfffe000000000007n])), 0));
        results.read_f32 = show(read.f32(ptr(new Uint32Array([0xffffffff])), 0));

        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        forge_true: ["number", "NaN"],
        forge_undefined: ["number", "NaN"],
        forge_int32: ["number", "NaN"],
        forge_cell: ["number", "NaN"],
        forge_f32: ["number", "NaN"],
        pure_nan: ["number", "NaN"],
        normal_double: ["number", "1.5"],
        echo_f64: ["number", "2.5"],
        callback_return: ["number", "0"],
        callback_arg: ["number", "NaN"],
        read_f64: ["number", "NaN"],
        read_f32: ["number", "NaN"],
      },
      exitCode: 0,
    });
  });

  // An f64 or f32 argument conversion (JSVALUE_DOUBLE_IN_PLACE and
  // JSVALUE_FLOAT_IN_PLACE in FFI.h) must decode int32-tagged JSValues: JSC tags
  // integral numbers as int32, so treating every numeric JSValue as double-encoded
  // hands C an impure NaN instead of the number. The C-side observers report
  // what the native code actually received, so these cannot pass by a
  // JS -> C -> JS round trip cancelling an encode bug against a decode bug.
  it("integral JS numbers reach C as the exact double, not NaN", async () => {
    using dir = tempDir("bun-ffi-int32-double", {
      "int32args.c": /* c */ `
        /* 1 => C saw the expected value, 2 => C saw NaN, 3 => something else */
        static int classify(double got, double expected) {
          if (got == expected) return 1;
          if (got != got) return 2;
          return 3;
        }
        int int32_arg_seen_by_c(double x) { return classify(x, 42.0); }
        int double_arg_seen_by_c(double x) { return classify(x, 1.5); }
        int f32_int32_arg_seen_by_c(float x) { return classify(x, 7.0f); }
        double echo_f64(double x) { return x; }

        typedef double (*js_cb)(double);
        int int32_callback_return_seen_by_c(js_cb cb) { return classify(cb(0.5), 3.0); }
      `,
      "fixture.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "int32args.c"),
          symbols: {
            int32_arg_seen_by_c: { args: ["f64"], returns: "int" },
            double_arg_seen_by_c: { args: ["f64"], returns: "int" },
            f32_int32_arg_seen_by_c: { args: ["f32"], returns: "int" },
            echo_f64: { args: ["f64"], returns: "f64" },
            int32_callback_return_seen_by_c: { args: ["ptr"], returns: "int" },
          },
        });

        const results = {
          int32_arg: symbols.int32_arg_seen_by_c(42),
          double_arg: symbols.double_arg_seen_by_c(1.5),
          f32_int32_arg: symbols.f32_int32_arg_seen_by_c(7),
          echo_int32: [typeof symbols.echo_f64(7), String(symbols.echo_f64(7))],
        };

        const callback = new JSCallback(() => 3, { args: ["f64"], returns: "f64" });
        results.int32_callback_return = symbols.int32_callback_return_seen_by_c(callback.ptr);
        callback.close();

        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        int32_arg: 1,
        double_arg: 1,
        f32_int32_arg: 1,
        echo_int32: ["number", "7"],
        int32_callback_return: 1,
      },
      exitCode: 0,
    });
  });

  // The f64 argument wrapper (ffiWrappers[FFIType.double] in ffi.ts) used
  // `if (!val) return 0`, which rewrote NaN and -0.0 to +0.0 before C ever
  // saw them, and its BigInt branch returned Math.abs() of the value. The C
  // functions report the value they received, so a JS round trip cannot mask
  // an argument-conversion bug. CFunction goes through the same
  // FFIBuilder/ffiWrappers path as dlopen; cc() only provides the pointers.
  it("f64 arguments reach C with NaN, -0.0, and BigInt sign intact", async () => {
    using dir = tempDir("bun-ffi-f64-args", {
      "observe.c": /* c */ `
        union f64bits { double d; unsigned long long u; };
        int isnan_f64(double x) { return x != x; }
        int signbit_f64(double x) { union f64bits c; c.d = x; return (int)(c.u >> 63); }
        double echo_f64(double x) { return x; }
        void* addr_isnan_f64(void) { return (void*)isnan_f64; }
        void* addr_signbit_f64(void) { return (void*)signbit_f64; }
        void* addr_echo_f64(void) { return (void*)echo_f64; }
      `,
      "fixture.js": /* js */ `
        import { cc, CFunction } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "observe.c"),
          symbols: {
            addr_isnan_f64: { args: [], returns: "ptr" },
            addr_signbit_f64: { args: [], returns: "ptr" },
            addr_echo_f64: { args: [], returns: "ptr" },
          },
        });

        const isnan_f64 = new CFunction({ ptr: symbols.addr_isnan_f64(), args: ["f64"], returns: "i32" });
        const signbit_f64 = new CFunction({ ptr: symbols.addr_signbit_f64(), args: ["f64"], returns: "i32" });
        const echo_f64 = new CFunction({ ptr: symbols.addr_echo_f64(), args: ["f64"], returns: "f64" });

        // Report a thrown conversion as a value so one failure cannot hide the rest.
        const show = fn => {
          try {
            const value = fn();
            return [typeof value, String(value)];
          } catch (err) {
            return ["threw", err.name];
          }
        };
        const results = {
          nan_isnan: isnan_f64(NaN),
          one_point_five_isnan: isnan_f64(1.5),
          negative_zero_signbit: signbit_f64(-0),
          positive_zero_signbit: signbit_f64(0),
          negative_one_signbit: signbit_f64(-1),
          negative_bigint: show(() => echo_f64(-5n)),
          positive_bigint: show(() => echo_f64(5n)),
          huge_bigint: show(() => echo_f64(2n ** 1024n)),
          negative_huge_bigint: show(() => echo_f64(-(2n ** 1024n))),
          fractional: show(() => echo_f64(-2.5)),
          string: show(() => echo_f64("2.5")),
          null_arg: show(() => echo_f64(null)),
          undefined_arg: show(() => echo_f64(undefined)),
        };
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        nan_isnan: 1,
        one_point_five_isnan: 0,
        negative_zero_signbit: 1,
        positive_zero_signbit: 0,
        negative_one_signbit: 1,
        negative_bigint: ["number", "-5"],
        positive_bigint: ["number", "5"],
        huge_bigint: ["number", "Infinity"],
        negative_huge_bigint: ["number", "-Infinity"],
        fractional: ["number", "-2.5"],
        string: ["threw", "TypeError"],
        null_arg: ["number", "0"],
        undefined_arg: ["number", "NaN"],
      },
      exitCode: 0,
    });
  });

  // An int-typed JSCallback return must decode double-encoded JSValues: whether
  // a JS number is int32-tagged or double-encoded is the engine's choice (JIT
  // tier, double speculation, Math.* provenance), so a return that truncates the
  // raw encoded bits hands C 0 once the callback tiers up.
  it("double-encoded JS numbers returned from an int-typed JSCallback reach C as the integer", async () => {
    using dir = tempDir("bun-ffi-int32-cb-return", {
      "cb.c": /* c */ `
        typedef int (*cb_i32)(int);
        int call_i32(cb_i32 f, int x) { return f(x); }
        typedef unsigned int (*cb_u32)(int);
        unsigned int call_u32(cb_u32 f, int x) { return f(x); }
        typedef signed char (*cb_i8)(int);
        int call_i8(cb_i8 f, int x) { return (int)f(x); }
        typedef unsigned short (*cb_u16)(int);
        int call_u16(cb_u16 f, int x) { return (int)f(x); }
      `,
      "fixture.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "cb.c"),
          symbols: {
            call_i32: { args: ["function", "i32"], returns: "i32" },
            call_u32: { args: ["function", "i32"], returns: "u32" },
            call_i8: { args: ["function", "i32"], returns: "i32" },
            call_u16: { args: ["function", "i32"], returns: "i32" },
          },
        });

        // +0.5 then -0.5 on a runtime value: integer-valued, but the intermediate
        // pins a double-represented result regardless of JIT tier or const-folding.
        const asDouble = x => {
          const v = x + 0.5;
          return v - 0.5;
        };
        const echoDouble = new JSCallback(asDouble, { args: ["i32"], returns: "i32" });
        // Plain int32-tagged return must keep working.
        const echoInt = new JSCallback(x => x, { args: ["i32"], returns: "i32" });
        const fractional = new JSCallback(() => 5.7, { args: ["i32"], returns: "i32" });
        const negFractional = new JSCallback(() => -5.7, { args: ["i32"], returns: "i32" });
        const u32Double = new JSCallback(x => asDouble(x) + 3000000000, { args: ["i32"], returns: "u32" });
        const i8Double = new JSCallback(asDouble, { args: ["i32"], returns: "i8" });
        const u16Double = new JSCallback(asDouble, { args: ["i32"], returns: "u16" });

        const results = {
          echo_double: symbols.call_i32(echoDouble.ptr, 938),
          echo_int: symbols.call_i32(echoInt.ptr, 938),
          fractional: symbols.call_i32(fractional.ptr, 0),
          neg_fractional: symbols.call_i32(negFractional.ptr, 0),
          u32_double: symbols.call_u32(u32Double.ptr, 0),
          i8_double: symbols.call_i8(i8Double.ptr, -7),
          u16_double: symbols.call_u16(u16Double.ptr, 40000),
        };
        for (const cb of [echoDouble, echoInt, fractional, negFractional, u32Double, i8Double, u16Double]) cb.close();
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        echo_double: 938,
        echo_int: 938,
        fractional: 5,
        neg_fractional: -5,
        u32_double: 3000000000,
        i8_double: -7,
        u16_double: 40000,
      },
      exitCode: 0,
    });
  });

  // napi_create_double and napi_create_date take the double from the addon
  // verbatim, so they are the same boundary. cc()-compiled C resolves napi_*
  // from the host process; that lookup is only exercised on POSIX today (see
  // cc-fixture.c).
  it.skipIf(isWindows)("impure NaNs through napi_create_double and napi_create_date are purified", async () => {
    using dir = tempDir("bun-ffi-impure-nan-napi", {
      "impure_napi.c": /* c */ `
        typedef struct napi_env_fake* napi_env_t;
        typedef struct napi_value_fake* napi_value_t;
        union caster { unsigned long long u; double d; };
        extern int napi_create_double(napi_env_t env, double value, napi_value_t* result);
        extern int napi_create_date(napi_env_t env, double time, napi_value_t* result);
        napi_value_t impure_from_napi(napi_env_t env) {
          union caster c; c.u = 0xfffe000000000007ULL;
          napi_value_t result;
          napi_create_double(env, c.d, &result);
          return result;
        }
        napi_value_t impure_date_from_napi(napi_env_t env) {
          union caster c; c.u = 0xfffe000000000007ULL;
          napi_value_t result;
          napi_create_date(env, c.d, &result);
          return result;
        }
      `,
      "fixture.js": /* js */ `
        import { cc } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "impure_napi.c"),
          symbols: {
            impure_from_napi: { args: ["napi_env"], returns: "napi_value" },
            impure_date_from_napi: { args: ["napi_env"], returns: "napi_value" },
          },
        });

        const value = symbols.impure_from_napi();
        // Unpurified, the Date constructor receives JSValue(true) and
        // produces new Date(1) instead of an Invalid Date.
        const date = symbols.impure_date_from_napi();
        console.log(
          JSON.stringify({
            double: [typeof value, String(value)],
            date: [date instanceof Date, String(date.getTime())],
          }),
        );
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        double: ["number", "NaN"],
        date: [true, "NaN"],
      },
      exitCode: 0,
    });
  });
});

it("a compiled symbol isn't a constructor", async () => {
  using dir = tempDir("bun-ffi-cc-construct", {
    "returns_true.c": "_Bool returns_true(void) { return 1; }\n",
    "fixture.js": /* js */ `
      import { cc } from "bun:ffi";
      import path from "path";

      const { symbols, close } = cc({
        source: path.join(import.meta.dir, "returns_true.c"),
        symbols: { returns_true: { args: [], returns: "bool" } },
      });
      console.log(symbols.returns_true());
      try {
        console.log(Reflect.construct(symbols.returns_true, []));
      } catch (e) {
        console.log(e.constructor.name);
      }
      console.log(Array.of.call(symbols.returns_true, 1, 2, 3));
      close();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("true\nTypeError\n[ 1, 2, 3 ]\n");
  expect(exitCode).toBe(0);
});

// cc()-compiled C resolves napi_* from the host process, which is only tested on POSIX (see cc-fixture.c).
it.skipIf(isWindows)("returns undefined for a NULL napi_value and throws a pending napi exception", async () => {
  using dir = tempDir("bun-ffi-napi-null-return", {
    "napi_null.c": /* c */ `
      typedef struct napi_env_fake* napi_env_t;
      typedef struct napi_value_fake* napi_value_t;
      extern int napi_throw_error(napi_env_t env, const char* code, const char* msg);

      napi_value_t returns_null(napi_env_t env) {
        return 0;
      }
      napi_value_t throws_then_returns_null(napi_env_t env) {
        napi_throw_error(env, "ERR_FROM_C", "thrown from C");
        return 0;
      }
    `,
    "fixture.js": /* js */ `
      import { cc } from "bun:ffi";
      import path from "path";

      const { symbols } = cc({
        source: path.join(import.meta.dir, "napi_null.c"),
        symbols: {
          returns_null: { args: ["napi_env"], returns: "napi_value" },
          throws_then_returns_null: { args: ["napi_env"], returns: "napi_value" },
        },
      });

      console.log(typeof symbols.returns_null());
      try {
        symbols.throws_then_returns_null();
        console.log("no throw");
      } catch (e) {
        console.log(e.code, e.message);
      }
      console.log(typeof symbols.returns_null());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("undefined\nERR_FROM_C thrown from C\nundefined\n");
  expect(exitCode).toBe(0);
});

describe.skipIf(isASAN)("compiler runtime header directory under BUN_TMPDIR", () => {
  const plantedHeader = "#define bool int\n#define true 100\n#define false 0\n";
  const files = {
    "sentinel.txt": "sentinel-unchanged\n",
    "add.c": /* c */ `
      #include <stdbool.h>
      int add(int a, int b) {
        return a + b + (int)true - 1;
      }
    `,
    "fixture.js": /* js */ `
      import { cc } from "bun:ffi";
      import path from "path";

      const { symbols } = cc({
        source: path.join(import.meta.dir, "add.c"),
        symbols: { add: { args: ["int", "int"], returns: "int" } },
      });
      console.log(symbols.add(1, 2));
    `,
  };

  async function runFixture(dir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: { ...bunEnv, BUN_TMPDIR: String(dir) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  }

  it.skipIf(isWindows)("compiles a source that includes a compiler runtime header", async () => {
    using dir = tempDir("bun-ffi-cc-rt-dir", files);

    const [stdout, stderr, exitCode] = await runFixture(String(dir));

    expect(readFileSync(path.join(String(dir), `bun-cc-${process.getuid!()}`, "stdbool.h"), "utf8")).toContain(
      "_STDBOOL_H",
    );
    expect(stdout).toBe("3\n");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)("does not write compiler runtime headers through a symlinked entry", async () => {
    using dir = tempDir("bun-ffi-cc-rt-dir-symlink", files);
    for (const name of ["bun-cc", `bun-cc-${process.getuid!()}`]) {
      const headerDir = path.join(String(dir), name);
      mkdirSync(headerDir, { recursive: true });
      chmodSync(headerDir, 0o755);
      symlinkSync("../sentinel.txt", path.join(headerDir, "stdbool.h"));
    }

    const [stdout, stderr, exitCode] = await runFixture(String(dir));

    expect(readFileSync(path.join(String(dir), "sentinel.txt"), "utf8")).toBe("sentinel-unchanged\n");
    expect(stdout).toBe("3\n");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)(
    "does not place compiler runtime headers in a pre-existing group- and world-writable directory",
    async () => {
      using dir = tempDir("bun-ffi-cc-rt-dir-mode", files);
      const sharedName = `bun-cc-${process.getuid!()}`;
      for (const name of ["bun-cc", sharedName]) {
        const headerDir = path.join(String(dir), name);
        mkdirSync(headerDir, { recursive: true });
        writeFileSync(path.join(headerDir, "stdbool.h"), plantedHeader);
      }
      chmodSync(path.join(String(dir), "bun-cc"), 0o755);
      chmodSync(path.join(String(dir), sharedName), 0o777);

      const [stdout, stderr, exitCode] = await runFixture(String(dir));

      expect(readFileSync(path.join(String(dir), "bun-cc", "stdbool.h"), "utf8")).toBe(plantedHeader);
      expect(readFileSync(path.join(String(dir), sharedName, "stdbool.h"), "utf8")).toBe(plantedHeader);
      expect(stdout).toBe("3\n");
      expect(exitCode).toBe(0);
    },
  );

  it("does not reuse a pre-existing fixed-name bun-cc directory for compiler runtime headers", async () => {
    using dir = tempDir("bun-ffi-cc-rt-dir-fixed-name", files);
    const fixedDir = path.join(String(dir), "bun-cc");
    mkdirSync(fixedDir, { recursive: true });
    writeFileSync(path.join(fixedDir, "stdbool.h"), plantedHeader);

    const [stdout, stderr, exitCode] = await runFixture(String(dir));

    const staged = readdirSync(String(dir)).filter(
      name => name !== "bun-cc" && name.includes("bun-cc") && existsSync(path.join(String(dir), name, "stdbool.h")),
    );
    expect(staged.length).toBe(1);
    expect(readFileSync(path.join(String(dir), staged[0], "stdbool.h"), "utf8")).toContain("_STDBOOL_H");
    expect(readdirSync(fixedDir).sort()).toEqual(["stdbool.h"]);
    expect(readFileSync(path.join(fixedDir, "stdbool.h"), "utf8")).toBe(plantedHeader);
    expect(stdout).toBe("3\n");
    expect(exitCode).toBe(0);
  });
});

// TinyCC keeps its parser and code generator in process globals, and bun builds
// it without its own locks. The lock cc() holds around every TinyCC call is the
// only thing that stops Workers that compile at the same time from corrupting
// that state.
describe("cc() called by several Workers at once", () => {
  const workers = 8;
  const files: Record<string, string> = {
    "fixture.mjs": /* js */ `
      import { cc } from "bun:ffi";
      import { join } from "node:path";
      import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

      const workers = ${workers};
      if (isMainThread) {
        // gate[0]: set when every Worker is up. gate[1]: Workers that woke up.
        const gate = new Int32Array(new SharedArrayBuffer(8));
        const results = [];
        let ready = 0;
        let exited = 0;
        for (let index = 0; index < workers; index++) {
          const worker = new Worker(import.meta.filename, { workerData: { gate, index } });
          worker.on("message", message => {
            if (message !== "ready") results[index] = message;
            else if (++ready === workers) {
              Atomics.store(gate, 0, 1);
              Atomics.notify(gate, 0);
            }
          });
          worker.on("exit", () => {
            if (++exited === workers) console.log(JSON.stringify(results));
          });
        }
      } else {
        const { gate, index } = workerData;
        const name = "add" + index;
        const options = {
          source: join(import.meta.dirname, name + ".c"),
          symbols: { [name]: { args: ["int", "int"], returns: "int" } },
        };
        parentPort.postMessage("ready");
        Atomics.wait(gate, 0, 0);
        // The wake-ups arrive microseconds apart. Spin until the last one, so
        // that every Worker starts to compile together.
        Atomics.add(gate, 1, 1);
        while (Atomics.load(gate, 1) < workers);
        const sums = [];
        for (let i = 0; i < 2; i++) {
          const lib = cc(options);
          sums.push(lib.symbols[name](i, 100));
          lib.close();
        }
        parentPort.postMessage(sums);
      }
    `,
  };
  for (let index = 0; index < workers; index++) {
    files[`add${index}.c`] = `int add${index}(int a, int b) { return a + b + ${index}; }\n`;
  }
  const expected = JSON.stringify(Array.from({ length: workers }, (_, index) => [100 + index, 101 + index]));

  it("compiles every source correctly", async () => {
    using dir = tempDir("bun-ffi-cc-workers", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(expected);
    expect(exitCode).toBe(0);
  });
});

// The gate runs before any option is read or any C is compiled, so these do
// not need a working TinyCC and run under ASan too. Without the gate, the
// empty `symbols` object makes cc() fail with a plain validation error, which
// is the control for "cc() was not blocked".
describe.concurrent("disabling cc()", () => {
  // `report` receives one string: the error code, or the message for an
  // error without a code, or "no-error".
  const probeWith = (report: string) => /* js */ `
    const { cc } = require("bun:ffi");
    try {
      cc({ source: "does-not-exist.c", symbols: {} });
      ${report}("no-error");
    } catch (e) {
      ${report}(e.code ?? e.message);
    }
  `;
  const probe = probeWith("console.log");

  async function run(...args: string[]): Promise<[stdout: string, stderr: string, exitCode: number]> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  }

  it("cc() is allowed by default", async () => {
    const [stdout, stderr, exitCode] = await run("-e", probe);
    expect(stdout).toBe("Expected at least one exported symbol\n");
    expect(exitCode).toBe(0);
  });

  it("--no-ffi-cc makes cc() throw ERR_FFI_CC_DISABLED", async () => {
    const [stdout, stderr, exitCode] = await run("--no-ffi-cc", "-e", probe);
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("--no-addons makes cc() throw ERR_FFI_CC_DISABLED", async () => {
    const [stdout, stderr, exitCode] = await run("--no-addons", "-e", probe);
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("the error message names the disabled compiler", async () => {
    const [stdout, stderr, exitCode] = await run(
      "--no-ffi-cc",
      "-p",
      'require("bun:ffi").cc({ source: "does-not-exist.c", symbols: {} })',
    );
    expect(stdout).toBe("");
    expect(stderr).toContain("error: Cannot compile C code because the bun:ffi C compiler is disabled.");
    expect(stderr).toContain('code: "ERR_FFI_CC_DISABLED"');
    expect(exitCode).toBe(1);
  });

  it("BUN_OPTIONS=--no-ffi-cc makes cc() throw ERR_FFI_CC_DISABLED", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", probe],
      env: { ...bunEnv, BUN_OPTIONS: "--no-ffi-cc" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  // The Worker runs the probe and posts its one line back to the parent. A
  // worker that fails before it posts is reported on stdout instead of
  // hanging the process.
  const workerHost = (execArgv: string) => /* js */ `
    const { Worker } = require("node:worker_threads");
    const source = ${JSON.stringify(probeWith("require('node:worker_threads').parentPort.postMessage"))};
    const worker = new Worker(source, { eval: true, execArgv: ${execArgv} });
    let reported = false;
    worker.on("message", msg => {
      reported = true;
      console.log(msg);
      worker.terminate();
    });
    worker.on("error", e => {
      reported = true;
      console.log("worker error: " + (e.code ?? e.message));
      worker.terminate();
    });
    worker.on("exit", code => {
      if (!reported) console.log("worker exited with " + code + " before posting");
    });
  `;

  it("--no-ffi-cc stays in effect inside a Worker with an empty execArgv", async () => {
    const [stdout, stderr, exitCode] = await run("--no-ffi-cc", "-e", workerHost("[]"));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("--no-addons stays in effect inside a Worker with an empty execArgv", async () => {
    const [stdout, stderr, exitCode] = await run("--no-addons", "-e", workerHost("[]"));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("a Worker can disable cc() for itself with execArgv", async () => {
    const [stdout, stderr, exitCode] = await run("-e", workerHost('["--no-ffi-cc"]'));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("a Worker cannot re-enable cc() that its parent disabled", async () => {
    const [stdout, stderr, exitCode] = await run("--no-ffi-cc", "-e", workerHost('["--smol"]'));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });
});
