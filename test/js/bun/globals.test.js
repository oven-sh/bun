import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

it("ERR_INVALID_THIS", () => {
  try {
    Request.prototype.formData.call(undefined);
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request");
  }

  try {
    Request.prototype.formData.call(null);
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request, but received null");
  }

  try {
    Request.prototype.formData.call(new (class Boop {})());
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request, but received an instance of Boop");
  }

  try {
    Request.prototype.formData.call("hellooo");
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe(`Expected this to be instanceof Request, but received type string ('hellooo')`);
  }

  // A bare call through a closure-captured binding hands the native function
  // the scope object as `this`; it must be reported like an undefined receiver.
  const { formData } = Request.prototype;
  function keep() {
    return formData;
  }
  try {
    formData();
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request");
  }
  expect(keep()).toBe(formData);
});

it("extendable", () => {
  const classes = [Blob, TextDecoder, TextEncoder, Request, Response, Headers, HTMLRewriter, Bun.Transpiler, Buffer];
  for (let Class of classes) {
    var Foo = class extends Class {};
    var bar = Class === Request ? new Request({ url: "https://example.com" }) : new Foo();
    expect(bar instanceof Class).toBe(true);
    expect(!!Class.prototype).toBe(true);
    expect(typeof Class.prototype).toBe("object");
  }
  expect(true).toBe(true);
});

it("writable", () => {
  const classes = [
    ["TextDecoder", TextDecoder],
    ["Request", Request],
    ["Response", Response],
    ["Headers", Headers],
    ["Buffer", Buffer],
    ["Event", Event],
    ["DOMException", DOMException],
    ["EventTarget", EventTarget],
    ["ErrorEvent", ErrorEvent],
    ["CustomEvent", CustomEvent],
    ["CloseEvent", CloseEvent],
    ["File", File],
  ];
  for (let [name, Class] of classes) {
    globalThis[name] = 123;
    expect(globalThis[name]).toBe(123);
    globalThis[name] = Class;
    expect(globalThis[name]).toBe(Class);
  }
});

it("name", () => {
  const classes = [
    ["Blob", Blob],
    ["TextDecoder", TextDecoder],
    ["TextEncoder", TextEncoder],
    ["Request", Request],
    ["Response", Response],
    ["Headers", Headers],
    ["HTMLRewriter", HTMLRewriter],
    ["Transpiler", Bun.Transpiler],
    ["Buffer", Buffer],
    ["File", File],
  ];
  for (let [name, Class] of classes) {
    expect(Class.name).toBe(name);
  }
});

// These classes come out of generate-classes.ts, which installs the same
// prototype and constructor boilerplate on every class it emits.
describe.each([
  ["Blob", Blob, Object.prototype],
  ["Request", Request, Object.prototype],
  ["Response", Response, Object.prototype],
  ["TextDecoder", TextDecoder, Object.prototype],
  ["HTMLRewriter", HTMLRewriter, Object.prototype],
  ["BuildMessage", BuildMessage, Error.prototype],
  ["ResolveMessage", ResolveMessage, Error.prototype],
  ["Transpiler", Bun.Transpiler, Object.prototype],
  ["CryptoHasher", Bun.CryptoHasher, Object.prototype],
  ["Glob", Bun.Glob, Object.prototype],
])("generated class %s", (name, Class, prototypeParent) => {
  it("prototype has a read-only, non-enumerable Symbol.toStringTag", () => {
    expect(Object.getOwnPropertyDescriptor(Class.prototype, Symbol.toStringTag)).toEqual({
      value: name,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  });

  it("prototype chain starts at the configured base", () => {
    expect(Object.getPrototypeOf(Class.prototype)).toBe(prototypeParent);
  });

  it("constructor.prototype is frozen in place", () => {
    expect(Object.getOwnPropertyDescriptor(Class, "prototype")).toEqual({
      value: Class.prototype,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  });

  it("calling the constructor without new throws ERR_ILLEGAL_CONSTRUCTOR", () => {
    expect(() => Class()).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_ILLEGAL_CONSTRUCTOR",
        message: `${name} constructor cannot be invoked without 'new'`,
      }),
    );
  });
});

it("generated class cached slots show up in heap snapshots", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "generated-class-heap-snapshot-fixture.js")],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const targetsByName = JSON.parse(stdout);
  // The fixture read request.headers and request.signal, so those cached
  // slots hold cells. The accessor targets come from Request.prototype.
  expect(targetsByName["headers"]).toContain("Headers");
  expect(targetsByName["signal"]).toContain("AbortSignal");
  // request.body and request.url were never read, so only the prototype
  // accessors show up under those names.
  expect(targetsByName["body"]).not.toContain("ReadableStream");
  expect(targetsByName["url"]).not.toContain("string");
  expect(exitCode).toBe(0);
});

describe("File", () => {
  it("constructor", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    expect(file.name).toBe("bar.txt");
    expect(file.type).toBe("text/plain;charset=utf-8");
    expect(file.size).toBe(3);
    expect(file.lastModified).toBeGreaterThan(0);
  });

  it("constructor with empty array", () => {
    const file = new File([], "empty.txt", { type: "text/plain;charset=utf-8" });
    expect(file.name).toBe("empty.txt");
    expect(file.size).toBe(0);
    expect(file.type).toBe("text/plain;charset=utf-8");
  });

  it("constructor with lastModified", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8", lastModified: 123 });
    expect(file.name).toBe("bar.txt");
    expect(file.type).toBe("text/plain;charset=utf-8");
    expect(file.size).toBe(3);
    expect(file.lastModified).toBe(123);
  });

  it("constructor with undefined name", () => {
    const file = new File(["foo"], undefined);
    expect(file.name).toBe("undefined");
    expect(file.type).toBe("");
    expect(file.size).toBe(3);
    expect(file.lastModified).toBeGreaterThan(0);
  });

  it("constructor throws invalid args", () => {
    const invalid = [[], [undefined], [null], [Symbol(), "foo"], [Symbol(), Symbol(), Symbol()]];
    for (let args of invalid) {
      expect(() => new File(...args)).toThrow();
    }
  });

  it("constructor without new", () => {
    const result = () => File();
    expect(result).toThrow({
      name: "TypeError",
      message: "Class constructor File cannot be invoked without 'new'",
    });
  });

  it("instanceof", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    expect(file instanceof File).toBe(true);
    expect(file instanceof Blob).toBe(true);
    expect(file instanceof Object).toBe(true);
    expect(file instanceof Function).toBe(false);
    const blob = new Blob(["foo"], { type: "text/plain;charset=utf-8" });
    expect(blob instanceof File).toBe(false);
  });

  it("extendable", async () => {
    class Foo extends File {
      constructor(...args) {
        super(...args);
      }

      bar() {
        return true;
      }

      text() {
        return super.text();
      }
    }
    const foo = new Foo(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    expect(foo instanceof File).toBe(true);
    expect(foo instanceof Blob).toBe(true);
    expect(foo instanceof Object).toBe(true);
    expect(foo instanceof Function).toBe(false);
    expect(foo instanceof Foo).toBe(true);
    expect(foo.bar()).toBe(true);
    expect(foo.name).toBe("bar.txt");
    expect(foo.type).toBe("text/plain;charset=utf-8");
    expect(foo.size).toBe(3);
    expect(foo.lastModified).toBeGreaterThanOrEqual(0);
    expect(await foo.text()).toBe("foo");
  });
});

it("globals are deletable", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "deletable-globals-fixture.js")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});

it("self is a getter", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
  expect(descriptor.get).toBeInstanceOf(Function);
  expect(descriptor.set).toBeInstanceOf(Function);
  expect(descriptor.enumerable).toBe(true);
  expect(descriptor.configurable).toBe(true);
  expect(globalThis.self).toBe(globalThis);
});

it("errors thrown by native code should be TypeError", async () => {
  expect(() => Bun.dns.prefetch()).toThrowError(TypeError);
  expect(async () => await fetch("http://localhost", { body: "123" })).toThrowError(TypeError);
});

describe("globalThis.gc", () => {
  /**
   * @param {string} expr
   * @param {string[]} args
   * @returns {string}
   */
  const runAndPrint = (expr, ...args) => {
    const result = Bun.spawnSync([bunExe(), ...args, "--print", expr], {
      env: bunEnv,
    });
    if (!result.success) throw new Error(result.stderr.toString("utf8"));
    return result.stdout.toString("utf8").trim();
  };

  describe("when --expose-gc is not passed", () => {
    it("globalThis.gc === undefined", () => {
      expect(runAndPrint("typeof globalThis.gc")).toEqual("undefined");
    });
    it(".gc does not take up a property slot", () => {
      expect(runAndPrint("'gc' in globalThis")).toEqual("false");
    });
  });

  describe("when --expose-gc is passed", () => {
    it("is a function", () => {
      expect(runAndPrint("typeof globalThis.gc", "--expose-gc")).toEqual("function");
    });

    it("gc is the same as globalThis.gc", () => {
      expect(runAndPrint("gc === globalThis.gc", "--expose-gc")).toEqual("true");
    });

    it("cleans up memory", () => {
      const src = /* js */ `
      let arr = []
      for (let i = 0; i < 100; i++) {
        arr.push(new Array(100_000));
      }
      arr.length = 0;

      const before = process.memoryUsage().heapUsed;
      globalThis.gc();
      const after = process.memoryUsage().heapUsed;
      return before - after;
      `;
      const expr = /* js */ `(function() { ${src} })()`;

      const delta = Number.parseInt(runAndPrint(expr, "--expose-gc"));
      expect(delta).not.toBeNaN();
      expect(delta).toBeGreaterThanOrEqual(0);
    });
  });
});
