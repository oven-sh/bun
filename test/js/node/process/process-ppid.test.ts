import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// In Node, process.ppid is a writable data property whose value comes from the OS on each read. An
// assignment through another receiver is an ordinary [[Set]]: it defines the value on the receiver.
// Here ppid was an accessor whose setter wrote the value onto any receiver directly: a frozen
// object that inherits from process gained the property, a Proxy receiver saw no trap, and a
// WebAssembly GC reference as the receiver aborted the process.
describe("process.ppid is a data property", () => {
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
      expect(Reflect.set(process, "ppid", 7, receiver)).toBe(false);
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
    expect(Reflect.set(process, "ppid", 7, proxy)).toBe(true);
    expect(calls).toEqual([["ppid", dataProperty(7)]]);
    expect(target).toEqual({ ppid: 7 });

    const refusing = new Proxy({}, { defineProperty: () => false });
    expect(Reflect.set(process, "ppid", 7, refusing)).toBe(false);
  });

  // In a subprocess because the first part aborted the process and the second part replaces process.ppid.
  test("a WebAssembly GC reference as the receiver is left alone, and process keeps an assigned value", async () => {
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
      console.log(Reflect.set(process, "ppid", 7, ref));

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
    expect(stdout.split("\n")).toEqual(["false", JSON.stringify(dataProperty("assigned")), ""]);
    expect(exitCode).toBe(0);
  });
});
