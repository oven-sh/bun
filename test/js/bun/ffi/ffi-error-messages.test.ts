import { CString, dlopen, linkSymbols, ptr, toArrayBuffer, toBuffer } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl } from "harness";

// Not `toThrow()`: it also accepts an Error that the function returns, which is
// what `toBuffer()` and `toArrayBuffer()` did with their TypeError before they
// threw it.
function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe.each([
  ["toBuffer", toBuffer],
  ["toArrayBuffer", toArrayBuffer],
] as const)("%s argument errors", (name, view) => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const address = ptr(bytes);
  const asArray = (result: Buffer | ArrayBuffer) => Array.from(new Uint8Array(result));

  test.each([
    ["a string ptr", () => view("x" as any), "ptr must be a number."],
    ["a negative ptr", () => view(-1 as any), "ptr must be a number."],
    ["a zero ptr", () => view(0 as any), "ptr cannot be zero, that would segfault Bun :("],
    ["a BigInt ptr past usize", () => view((2n ** 64n) as any), "ptr is out of range."],
    ["a sentinel ptr", () => view(0xdeadbeef as any), "ptr to invalid memory, that would segfault Bun :("],
    ["a string byteOffset", () => view(address, "garbage" as any, 8), "Expected number for byteOffset"],
    ["an object byteOffset", () => view(address, {} as any, 8), "Expected number for byteOffset"],
    ["an infinite byteOffset", () => view(address, Infinity, 8), "ptr must be a finite number."],
    ["a string byteLength", () => view(address, 0, "x" as any), "length must be a number."],
    ["a zero byteLength", () => view(address, 0, 0), "length must be > 0. This usually means a bug in your code."],
    ["a negative byteLength", () => view(address, 0, -1), "length must be > 0. This usually means a bug in your code."],
    ["a NaN byteLength", () => view(address, 0, NaN), "length must be > 0. This usually means a bug in your code."],
    [
      "a byteLength that truncates to zero",
      () => view(address, 0, 0.5),
      "length must be > 0. This usually means a bug in your code.",
    ],
    [
      "a string finalization callback",
      () => (view as any)(address, 0, 8, "x"),
      "Expected callback to be a C pointer (number or BigInt)",
    ],
    [
      "a string finalization callback after user data",
      () => (view as any)(address, 0, 8, 1, "x"),
      "Expected callback to be a C pointer (number or BigInt)",
    ],
    [
      "string user data",
      () => (view as any)(address, 0, 8, "x", 1),
      "Expected user data to be a C pointer (number or BigInt)",
    ],
  ])(`${name} throws a TypeError for %s`, (_, call, message) => {
    const err = thrownBy(call);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe(message);
  });

  test(`${name} accepts an undefined or null byteOffset`, () => {
    // `bytes` stays referenced here so its storage outlives every test above.
    expect(asArray(view(address, undefined, 8))).toEqual(Array.from(bytes));
    expect(asArray(view(address, null as any, 8))).toEqual(Array.from(bytes));
    expect(asArray(view(address, 2, 4))).toEqual(Array.from(bytes.subarray(2, 6)));
  });
});

describe("CString argument errors", () => {
  test("CString throws a TypeError for a negative ptr", () => {
    const err = thrownBy(() => new CString(-1 as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe("ptr must be a number.");
  });

  test("CString reads the bytes at ptr + byteOffset", () => {
    const bytes = new TextEncoder().encode("hello\0");
    expect(`${new CString(ptr(bytes), 1, 4)}`).toBe("ello");
    expect(`${new CString(ptr(bytes))}`).toBe("hello");
  });
});

// `new CString(ptr)` evaluates to a string primitive, which a constructor must not return. So CString is a
// constructor to nothing but a `new CString()` expression: what asks IsConstructor first gets false.
// Subprocess because a build where CString is a constructor crashes at most of these doors.
describe("CString is not a constructor to anything that asks first", () => {
  async function run(body: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { CString, ptr } from "bun:ffi";
        const hello = Buffer.from("hello\\0");
        globalThis.pinned = hello;
        const p = ptr(hello);
        class Species extends Array {
          static get [Symbol.species]() {
            return CString;
          }
        }
        const reparent = X => (Object.setPrototypeOf(X, CString), X);
        async function print(door) {
          try {
            return JSON.stringify(await door());
          } catch (e) {
            return e.name;
          }
        }
        ${body}
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent.each([
    // IsConstructor is false, so these make a plain array.
    ["Array.of", `Array.of.call(CString, 1, 2, 3)`, "[1,2,3]"],
    ["Array.from", `Array.from.call(CString, [1, 2, 3])`, "[1,2,3]"],
    // These need a constructor.
    ["Symbol.species", `new Species(1, 2, 3).filter(() => true)`, "TypeError"],
    ["Reflect.construct", `Reflect.construct(CString, [p])`, "TypeError"],
  ])("%s", async (_, expression, printed) => {
    expect(await run(`console.log(await print(() => ${expression}));`)).toEqual({
      stdout: printed + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("every other door", async () => {
    const doors = [
      ["new of a bound CString", `new (CString.bind(null))(p)`, "TypeError"],
      ["new of a Proxy of CString", `new (new Proxy(CString, {}))(p)`, "TypeError"],
      ["extends", `new (class extends CString {})(p)`, "TypeError"],
      // super() asks nothing. It gets to CString with the class as new.target.
      ["super() of a re-parented class", `new (reparent(class extends Array { field = 1; }))()`, "TypeError"],
      [
        "super(validPointer) of a re-parented class",
        `new (reparent(class extends Array { constructor() { super(p); } }))()`,
        "TypeError",
      ],
      ["Array.of on a re-parented class", `Array.of.call(reparent(class extends Array {}), 1, 2, 3)`, "TypeError"],
      ["Array.from on a re-parented class", `Array.from.call(reparent(class extends Array {}), [1])`, "TypeError"],
      ["Array.of with no items", `Array.of.call(CString)`, "[]"],
      ["Array.from an array-like", `Array.from.call(CString, { length: 2, 0: "a", 1: "b" })`, `["a","b"]`],
      ["Array.fromAsync", `Array.fromAsync.call(CString, [1, 2])`, "[1,2]"],
      ["Uint8Array.of", `Uint8Array.of.call(CString, 1)`, "TypeError"],
      ["Symbol.species filter of an empty array", `new Species().filter(() => true)`, "TypeError"],
      ["Symbol.species map", `new Species(1, 2, 3).map(x => x)`, "TypeError"],
      ["Symbol.species slice", `new Species(1, 2, 3).slice()`, "TypeError"],
      ["Symbol.species concat", `new Species(1, 2, 3).concat([4])`, "TypeError"],
      [
        "Symbol.species of an own constructor property",
        `Object.assign([1, 2, 3], { constructor: { [Symbol.species]: CString } }).map(x => x)`,
        "TypeError",
      ],
      [
        "ArrayBuffer Symbol.species",
        `new (class extends ArrayBuffer { static get [Symbol.species]() { return CString; } })(8).slice(0, 4)`,
        "TypeError",
      ],
      ["Reflect.construct with no arguments", `Reflect.construct(CString, [])`, "TypeError"],
      ["Reflect.construct with CString as new.target", `Reflect.construct(Object, [], CString)`, "TypeError"],
    ];
    // One line per door, printed when the door returns: a crash leaves the lines of the doors before it.
    const body = doors.map(
      ([door, expression]) => `console.log(${JSON.stringify(door + ": ")} + (await print(() => ${expression})));`,
    );
    expect(await run(body.join("\n"))).toEqual({
      stdout: doors.map(([door, , printed]) => `${door}: ${printed}\n`).join(""),
      stderr: "",
      exitCode: 0,
    });
  });

  test("new CString(ptr) and CString(ptr) return the string when the call site is hot", () => {
    const bytes = new TextEncoder().encode("hello\0");
    const address = ptr(bytes);
    const args = [address];
    function direct() {
      return (
        +(new CString(address) === "hello") +
        +(new CString(...args) === "hello") +
        +(new CString(address, 1, 3) === "ell") +
        +(new CString(0 as any) === "") +
        +(CString(address) === "hello") +
        +(CString(...args) === "hello")
      );
    }
    let wrong = 0;
    for (let i = 0; i < 10_000; i++) if (direct() !== 6) wrong++;
    expect({ wrong, byteLength: bytes.byteLength }).toEqual({ wrong: 0, byteLength: 6 });
  });

  test("a call through bind or a Proxy returns the string", () => {
    const bytes = new TextEncoder().encode("hello\0");
    expect([CString.bind(null, ptr(bytes))(), new Proxy(CString, {})(ptr(bytes))]).toEqual(["hello", "hello"]);
  });

  test("CString is a function with no prototype property", () => {
    expect({ type: typeof CString, length: CString.length, hasPrototype: "prototype" in CString }).toEqual({
      type: "function",
      length: 3,
      hasPrototype: false,
    });
  });

  test("CString prints as a function", () => {
    expect({ alone: Bun.inspect(CString), nested: Bun.inspect({ CString }) }).toEqual({
      alone: "[Function: CString]",
      nested: "{\n  CString: [Function: CString],\n}",
    });
    expect({ CString }).toMatchInlineSnapshot(`
      {
        "CString": [Function: CString],
      }
    `);
  });
});

describe("FFI error messages", () => {
  test("dlopen shows library name when library cannot be opened", () => {
    // Try to open a non-existent library
    try {
      dlopen("libnonexistent12345.so", {
        test: {
          args: [],
          returns: "int",
        },
      });
      expect.unreachable("Should have thrown an error");
    } catch (err: any) {
      // Error message should include the library name
      expect(err.message).toContain("libnonexistent12345.so");
      expect(err.message).toMatch(/Failed to open library/i);
    }
  });

  test("dlopen shows which symbol is missing when symbol not found", () => {
    // Use appropriate system library for the platform
    const libName =
      process.platform === "win32"
        ? "kernel32.dll" // Windows system library
        : process.platform === "darwin"
          ? "libSystem.B.dylib" // macOS system library
          : isMusl
            ? process.arch === "arm64"
              ? "libc.musl-aarch64.so.1" // ARM64 musl
              : "libc.musl-x86_64.so.1" // x86_64 musl
            : "libc.so.6"; // glibc

    // Try to load a non-existent symbol
    try {
      dlopen(libName, {
        this_symbol_definitely_does_not_exist_in_the_system_library: {
          args: [],
          returns: "int",
        },
      });
      expect.unreachable("Should have thrown an error");
    } catch (err: any) {
      // Error message should include the symbol name
      expect(err.message).toMatch(/this_symbol_definitely_does_not_exist_in_the_system_library/);
      // Error message should include some reference to the library or symbol not found
      expect(err.message).toMatch(/Symbol.*not found|symbol.*not found/i);
    }
  });

  test("linkSymbols shows helpful error when ptr is missing", () => {
    // Try to use linkSymbols without providing a valid ptr
    expect(() => {
      linkSymbols({
        myFunction: {
          args: [],
          returns: "int",
          // Missing 'ptr' field - this should give a helpful error
        },
      });
    }).toThrow(/myFunction.*ptr.*(linkSymbols|CFunction)/);
  });

  test("linkSymbols with non-object property values throws TypeError", () => {
    expect(() => {
      linkSymbols({ foo: 42 });
    }).toThrow("Expected an object");

    expect(() => {
      linkSymbols({ a: "hello", b: 123, c: true });
    }).toThrow("Expected an object");
  });

  test("linkSymbols with non-number ptr does not crash", () => {
    expect(() => {
      linkSymbols({
        fn: {
          // @ts-expect-error
          ptr: "not a number",
        },
      });
    }).toThrow('you must provide a "ptr" field with the memory address of the native function.');
  });
});
