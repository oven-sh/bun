import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Node has no JS-visible setter for process.ppid: it is a native data property, and an assignment
// through an object that inherits from process defines an own data property on that object. Here
// ppid is an accessor, and its setter shadows the accessor with an own data property on `this`. The
// setter used to write that property directly, which skipped the receiver's own
// [[DefineOwnProperty]]: a frozen object gained a property, a Proxy saw no trap, and a WebAssembly
// GC reference aborted the process.
describe("process.ppid setter", () => {
  const { set } = Object.getOwnPropertyDescriptor(process, "ppid")!;
  const dataProperty = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });

  test("an object that inherits from process gets an own data property", () => {
    const child = Object.create(process);
    child.ppid = "assigned";
    expect(Object.getOwnPropertyDescriptor(child, "ppid")).toEqual(dataProperty("assigned"));
    expect(process.ppid).toBeNumber();
  });

  test("a receiver that is not extensible rejects the property", () => {
    for (const lock of [Object.freeze, Object.seal, Object.preventExtensions]) {
      const receiver = lock({});
      expect(() => set!.call(receiver, 7)).toThrow(TypeError);
      expect(Reflect.ownKeys(receiver)).toEqual([]);

      const child = lock(Object.create(process));
      expect(() => {
        child.ppid = 7;
      }).toThrow(TypeError);
      expect(Reflect.ownKeys(child)).toEqual([]);
      expect(child.ppid).toBe(process.ppid);
    }
  });

  test("a Proxy receiver gets its defineProperty trap called", () => {
    const calls: unknown[] = [];
    const target = {};
    const proxy = new Proxy(target, {
      defineProperty(target, key, descriptor) {
        calls.push([key, descriptor]);
        return Reflect.defineProperty(target, key, descriptor);
      },
    });
    set!.call(proxy, 7);
    expect(calls).toEqual([["ppid", dataProperty(7)]]);
    expect(target).toEqual({ ppid: 7 });

    const refusing = new Proxy({}, { defineProperty: () => false });
    expect(() => set!.call(refusing, 7)).toThrow(TypeError);
  });

  // In a subprocess because the first part aborted the process and the second part replaces process.ppid.
  test("a WebAssembly GC reference throws a TypeError, and process itself keeps an assigned value", async () => {
    const src = `
      // (module (type $s (struct (field (mut i32))))
      //   (func (export "mk") (result (ref null $s)) struct.new_default $s))
      const bytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x0a, 0x02, 0x5f, 0x01, 0x7f, 0x01, 0x60, 0x00, 0x01, 0x63, 0x00,
        0x03, 0x02, 0x01, 0x01,
        0x07, 0x06, 0x01, 0x02, 0x6d, 0x6b, 0x00, 0x00,
        0x0a, 0x07, 0x01, 0x05, 0x00, 0xfb, 0x01, 0x00, 0x0b,
      ]);
      const ref = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
      const { set } = Object.getOwnPropertyDescriptor(process, "ppid");
      try {
        set.call(ref, 7);
        console.log("no error");
      } catch (e) {
        console.log(e.constructor.name);
      }

      process.ppid = "assigned";
      console.log(JSON.stringify(Object.getOwnPropertyDescriptor(process, "ppid")));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.split("\n")).toEqual(["TypeError", JSON.stringify(dataProperty("assigned")), ""]);
    expect(exitCode).toBe(0);
  });
});
