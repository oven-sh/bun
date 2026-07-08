import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

describe("node:test", () => {
  test("should run basic tests", async () => {
    const { exitCode, stderr } = await runTests(["01-harness.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run hooks in the right order", async () => {
    const { exitCode, stderr } = await runTests(["02-hooks.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run tests with different variations", async () => {
    const { exitCode, stderr } = await runTests(["03-test-variations.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run async tests", async () => {
    const { exitCode, stderr } = await runTests(["04-async-tests.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run all tests from multiple files", async () => {
    const { exitCode, stderr } = await runTests(["01-harness.js", "02-hooks.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      // 32 from 01-harness + 3 from 02-hooks
      stderr: expect.stringContaining("35 pass"),
    });
  });

  test("should throw NotImplementedError if you call test() or describe() inside another test()", async () => {
    const { exitCode, stderr } = await runTests(["05-test-in-test.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });
});

async function runTests(filenames: string[]) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "test", ...testPaths],
    env: bunEnv,
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    exited,
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("node:test mock", () => {
  const { mock } = require("node:test");

  test("mock.getter accepts the (object, methodName, options) overload", () => {
    const obj = {
      get prop() {
        return "original";
      },
    };
    // Passing an options object in the implementation slot must not clobber
    // the getter flag.
    const getter = mock.getter(obj, "prop", {});
    expect(obj.prop).toBe("original");
    expect(getter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.setter accepts the (object, methodName, options) overload", () => {
    let stored = "";
    const obj = {
      set prop(v: string) {
        stored = v;
      },
    };
    const setter = mock.setter(obj, "prop", {});
    obj.prop = "x";
    expect(stored).toBe("x");
    expect(setter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.getter rejects getter: false", () => {
    const obj = {
      get prop() {
        return 1;
      },
    };
    expect(() => mock.getter(obj, "prop", { getter: false })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.method rejects getter and setter together", () => {
    const obj = {
      get prop() {
        return 1;
      },
      set prop(_v) {},
    };
    expect(() => mock.method(obj, "prop", { getter: true, setter: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.fn options.times reverts to the original after N calls", () => {
    const original = () => "original";
    const impl = () => "mocked";
    const fn = mock.fn(original, impl, { times: 2 });
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("original");
    expect(fn.mock.callCount()).toBe(3);
    mock.restoreAll();
  });

  test("mock.method options.times restores the method after N calls", () => {
    const obj = {
      value: 5,
      addOne() {
        return this.value + 1;
      },
    };
    mock.method(obj, "addOne", () => 100, { times: 1 });
    expect(obj.addOne()).toBe(100);
    expect(obj.addOne()).toBe(6);
    mock.restoreAll();
  });

  test("mock.fn options.times is validated", () => {
    expect(() => mock.fn(() => {}, { times: 0 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(() => mock.fn(() => {}, { times: 1.5 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
  });

  test("mock.restoreAll makes bare mock.fn mocks call their original again", () => {
    const fn = mock.fn(
      () => "original",
      () => "mocked",
    );
    expect(fn()).toBe("mocked");
    mock.restoreAll();
    expect(fn()).toBe("original");
  });
});

describe("node:test mock tracker semantics", () => {
  const { mock } = require("node:test");

  test("restoreAll keeps mocks associated; reset disassociates", () => {
    // mirrors observed node behavior exactly
    const f = mock.fn(
      () => "orig",
      () => "mocked",
    );
    expect(f()).toBe("mocked");
    mock.restoreAll();
    expect(f()).toBe("orig");
    // still tracked after restoreAll: reset() reverts a re-installed
    // implementation again
    f.mock.mockImplementation(() => "again");
    expect(f()).toBe("again");
    mock.reset();
    expect(f()).toBe("orig");
    // after reset() the context is disassociated: restoreAll no longer
    // touches it
    f.mock.mockImplementation(() => "post-reset");
    mock.restoreAll();
    expect(f()).toBe("post-reset");
    mock.reset();
  });

  test("queued once-implementations survive restoreAll like node", () => {
    const g = mock.fn(
      () => "g-orig",
      () => "g-mocked",
    );
    g.mock.mockImplementationOnce(() => "g-once", 1);
    mock.restoreAll();
    expect([g(), g(), g()]).toEqual(["g-orig", "g-once", "g-orig"]);
    mock.reset();
  });

  test("mock.method validates a non-object options argument", () => {
    const obj = {
      foo() {},
    };
    expect(() => mock.method(obj, "foo", () => {}, 5)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

describe("node:test mock.fn is a transparent Proxy", () => {
  const { mock } = require("node:test");

  class Service {
    url: string;
    static kind = "svc";
    constructor(url: string) {
      this.url = url;
    }
    fetch() {
      return "real:" + this.url;
    }
  }

  test("mocking a constructor preserves prototype, statics and instanceof", () => {
    const MockedService = mock.fn(Service);
    const s = new MockedService("http://x");
    expect({
      instanceOf: s instanceof Service,
      protoMethod: typeof s.fetch,
      fetchResult: s.fetch(),
      prototypeIdentity: MockedService.prototype === Service.prototype,
      staticKind: MockedService.kind,
      callCount: MockedService.mock.callCount(),
    }).toEqual({
      instanceOf: true,
      protoMethod: "function",
      fetchResult: "real:http://x",
      prototypeIdentity: true,
      staticKind: "svc",
      callCount: 1,
    });
    mock.reset();
  });

  test("construct call record has target=original and this=result, like node", () => {
    const MockedService = mock.fn(Service);
    const s = new MockedService("http://y");
    const call = MockedService.mock.calls[0];
    expect({
      targetIsOriginal: call.target === Service,
      thisIsResult: call.this === s,
      resultIsInstance: call.result === s,
      args: call.arguments,
    }).toEqual({
      targetIsOriginal: true,
      thisIsResult: true,
      resultIsInstance: true,
      args: ["http://y"],
    });
    mock.reset();
  });

  test("name and length pass through from the original", () => {
    function orig(a: number, b: number, c: number) {
      return a + b + c;
    }
    const m = mock.fn(orig);
    expect({ name: m.name, length: m.length, proto: typeof m.prototype }).toEqual({
      name: "orig",
      length: 3,
      proto: "object",
    });
    mock.reset();
  });

  test("a mocked arrow function is not constructible and records no call", () => {
    const arrow = (a: number, b: number) => a + b;
    const m = mock.fn(arrow);
    expect(typeof m.prototype).toBe("undefined");
    expect(() => new (m as any)(1, 2)).toThrow(TypeError);
    expect(m.mock.callCount()).toBe(0);
    expect(m(1, 2)).toBe(3);
    expect(m.mock.callCount()).toBe(1);
    mock.reset();
  });

  test("properties pass through to the original function", () => {
    function original() {}
    const m = mock.fn(original);
    (original as any).custom = 42;
    expect((m as any).custom).toBe(42);
    mock.reset();
  });
});

test("the call record is pushed after the implementation runs, like node", () => {
  const { mock } = require("node:test");
  let inside = -1;
  const f = mock.fn(function () {
    inside = f.mock.callCount();
    return 1;
  });
  f();
  expect(inside).toBe(0);
  expect(f.mock.callCount()).toBe(1);
  mock.reset();
});
