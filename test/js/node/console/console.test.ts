import { describe, expect, test } from "bun:test";
import consoleModule, { Console } from "node:console";

import { Writable } from "node:stream";

function writable() {
  let intoString = "";
  const { promise, resolve } = Promise.withResolvers();
  const stream = new Writable({
    write(chunk) {
      intoString += chunk.toString();
    },
    destroy() {
      resolve(intoString);
    },
    autoDestroy: true,
  });

  (stream as any).write = (chunk: any) => {
    intoString += Buffer.from(chunk).toString("utf-8");
  };

  return [stream, () => promise] as const;
}

describe("console.Console", () => {
  test("global instanceof Console", () => {
    expect(global.console).toBeInstanceOf(Console);
  });

  test("new Console instanceof Console", () => {
    const c = new Console({ stdout: process.stdout, stderr: process.stderr });
    expect(c).toBeInstanceOf(Console);
  });

  test("it can write to a stream", async () => {
    console.log();
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: false });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: 'bar' }\n");
  });

  test("can enable colors", async () => {
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: true });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: \u001B[32m'bar'\u001B[39m }\n");
  });

  test("stderr and stdout are separate", async () => {
    const [out, outValue] = writable();
    const [err, errValue] = writable();
    const c = new Console({ stdout: out, stderr: err });
    c.log("hello world!");
    c.error("uh oh!");
    out.end();
    err.end();
    expect(await outValue()).toBe("hello world!\n");
    expect(await errValue()).toBe("uh oh!\n");
  });
});

test("console._stdout", () => {
  // @ts-ignore
  expect(console._stdout).toBe(process.stdout);

  expect(Object.getOwnPropertyDescriptor(console, "_stdout")).toEqual({
    value: process.stdout,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

test("console._stderr", () => {
  // @ts-ignore
  expect(console._stderr).toBe(process.stderr);

  expect(Object.getOwnPropertyDescriptor(console, "_stderr")).toEqual({
    value: process.stderr,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

describe("console.createTask", () => {
  test("exists on the global console and node:console", () => {
    expect(typeof console.createTask).toBe("function");
    expect(consoleModule.createTask).toBe(console.createTask);
  });

  test("run calls the function and returns its result", () => {
    const task = console.createTask("test task");
    expect(task.run(() => 42)).toBe(42);
    // the task is recurring: run can be called again
    expect(task.run(() => 7)).toBe(7);
  });

  test("task shape matches Node", () => {
    const t1 = console.createTask("a");
    const t2 = console.createTask("b");
    expect(Object.getOwnPropertyNames(t1)).toEqual(["run"]);
    expect(Object.getPrototypeOf(t1)).toBe(Object.prototype);
    // Node shares one run function across tasks
    expect(t1.run).toBe(t2.run);
  });

  test("createTask validates the name", () => {
    expect(() => console.createTask("")).toThrow("First argument must be a non-empty string.");
    expect(() => (console as any).createTask(123)).toThrow("First argument must be a non-empty string.");
    expect(() => (console as any).createTask()).toThrow("First argument must be a non-empty string.");
  });

  test("run validates the function before the receiver", () => {
    const t1 = console.createTask("a");
    const t2 = console.createTask("b");
    expect(() => (t1 as any).run(5)).toThrow("First argument must be a function.");
    expect(() => (t1.run as any).call({}, () => 1)).toThrow("'run' called with illegal receiver.");
    expect(() => (t1.run as any).call({}, 5)).toThrow("First argument must be a function.");
    // another task is a valid receiver in Node
    expect((t1.run as any).call(t2, () => 9)).toBe(9);
  });

  test("run propagates exceptions and the task stays usable", () => {
    const task = console.createTask("boom");
    expect(() =>
      task.run(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(task.run(() => 1)).toBe(1);
  });

  test("the callback is called with an undefined receiver", () => {
    const task = console.createTask("this");
    expect(
      task.run(function (this: unknown) {
        return this;
      } as any),
    ).toBeUndefined();
  });

  test("createTask is an enumerable own property of console", () => {
    void console.createTask;
    expect(Object.keys(console)).toContain("createTask");
    expect(Object.getOwnPropertyDescriptor(console, "createTask")).toEqual({
      value: console.createTask,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  test("createTask is not a constructor", () => {
    expect(() => new (console.createTask as any)("x")).toThrow(TypeError);
  });

  test("Console class instances do not have createTask", () => {
    const c = new Console({ stdout: process.stdout, stderr: process.stderr });
    expect("createTask" in c).toBe(false);
  });
});
