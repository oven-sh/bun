import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import vm from "node:vm";

test("Listener.getsockname works with an object argument", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  const out: Record<string, unknown> = {};
  const result = listener.getsockname(out);
  expect(result).toBeUndefined(); // returns undefined, populates object in-place
  expect(out).toEqual(
    expect.objectContaining({
      family: expect.any(String),
      address: expect.any(String),
      port: expect.any(Number),
    }),
  );
});

test("Listener.getsockname throws with non-object argument", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  expect(() => (listener as any).getsockname(123)).toThrow();
  expect(() => (listener as any).getsockname("foo")).toThrow();
});

test("Listener.getsockname throws with no argument", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  // Previously crashed with null pointer dereference in BunString.cpp
  // when called without an object argument. Now it should throw a TypeError.
  expect(() => (listener as any).getsockname()).toThrow();
});

// getsockname(out) assigns to an object of the caller. As in Node's handle.getsockname(out), each store is a [[Set]],
// and a store that `out` refuses is not an error:
// https://github.com/nodejs/node/blob/v26.3.0/src/tcp_wrap.cc#L567-L583
// The order (family, address, port) and the return value (undefined) are Bun's. Node stores address, family, port
// and returns 0.
describe("Listener.getsockname(out) assigns to out", () => {
  const data = { value: true, writable: true, enumerable: true, configurable: true };

  function listen() {
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    return listener as typeof listener & { getsockname(out: unknown): undefined };
  }

  function thrownBy(fn: () => unknown) {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return "did not throw";
  }

  test("a plain object gets three data properties, also on a second call", () => {
    using listener = listen();
    const out = {};
    expect(listener.getsockname(out)).toBeUndefined();
    expect(listener.getsockname(out)).toBeUndefined();
    expect(Reflect.ownKeys(out)).toEqual(["family", "address", "port"]);
    expect(Object.getOwnPropertyDescriptors(out)).toEqual({
      family: { ...data, value: "IPv4" },
      address: { ...data, value: "127.0.0.1" },
      port: { ...data, value: listener.port },
    });
  });

  test.each([
    ["a function", () => function () {}],
    ["an array", () => []],
    ["a null-prototype object", () => Object.create(null)],
    ["an object from a node:vm context", () => vm.runInNewContext("({})")],
  ])("%s gets the three properties", (_, make) => {
    using listener = listen();
    const out = make();
    expect(listener.getsockname(out)).toBeUndefined();
    expect({ family: out.family, address: out.address, port: out.port }).toEqual({
      family: "IPv4",
      address: "127.0.0.1",
      port: listener.port,
    });
  });

  test.each([
    ["frozen", Object.freeze],
    ["sealed", Object.seal],
    ["non-extensible", Object.preventExtensions],
  ])("a %s object is not changed", (_, lock) => {
    using listener = listen();
    const out = lock({});
    expect(listener.getsockname(out)).toBeUndefined();
    expect(Reflect.ownKeys(out)).toEqual([]);
    expect(Object.isFrozen(out)).toBe(true);
  });

  test("a sealed object takes the properties that it has", () => {
    using listener = listen();
    const out = Object.seal({ port: 0 });
    expect(listener.getsockname(out)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptors(out)).toEqual({
      port: { ...data, value: listener.port, configurable: false },
    });
  });

  test("a read-only property keeps its value", () => {
    using listener = listen();
    const readOnly = { value: "read-only", writable: false, enumerable: true, configurable: false };
    const out = Object.defineProperty({}, "address", readOnly);
    expect(listener.getsockname(out)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptors(out)).toEqual({
      address: readOnly,
      family: { ...data, value: "IPv4" },
      port: { ...data, value: listener.port },
    });
  });

  test("an own setter and an inherited setter get the value", () => {
    using listener = listen();
    const seen: unknown[] = [];
    const proto = {
      set port(value: unknown) {
        seen.push(["port", value]);
      },
    };
    const out = Object.create(proto, {
      address: {
        get: () => "from the getter",
        set: value => void seen.push(["address", value]),
        enumerable: true,
        configurable: false,
      },
    });
    expect(listener.getsockname(out)).toBeUndefined();
    expect(seen).toEqual([
      ["address", "127.0.0.1"],
      ["port", listener.port],
    ]);
    expect(Reflect.ownKeys(out)).toEqual(["address", "family"]);
    expect(out.address).toBe("from the getter");
  });

  test("a Proxy gets one set trap for each property", () => {
    using listener = listen();
    const calls: unknown[] = [];
    const target = {};
    const out: object = new Proxy(target, {
      set(target, key, value, receiver) {
        calls.push([key, value, receiver === out]);
        return Reflect.set(target, key, value);
      },
    });
    expect(listener.getsockname(out)).toBeUndefined();
    expect(calls).toEqual([
      ["family", "IPv4", true],
      ["address", "127.0.0.1", true],
      ["port", listener.port, true],
    ]);
    expect(target).toEqual({ family: "IPv4", address: "127.0.0.1", port: listener.port });
  });

  test("a set trap that returns false is not an error", () => {
    using listener = listen();
    const calls: unknown[] = [];
    const target = {};
    const out = new Proxy(target, {
      set(_, key) {
        calls.push(key);
        return false;
      },
    });
    expect(listener.getsockname(out)).toBeUndefined();
    expect(calls).toEqual(["family", "address", "port"]);
    expect(Reflect.ownKeys(target)).toEqual([]);
  });

  test("a set trap that throws stops the call", () => {
    using listener = listen();
    const error = new RangeError("from the set trap");
    const calls: unknown[] = [];
    const target = {};
    const out = new Proxy(target, {
      set(_, key) {
        calls.push(key);
        throw error;
      },
    });
    expect(thrownBy(() => listener.getsockname(out))).toBe(error);
    expect(calls).toEqual(["family"]);
    expect(Reflect.ownKeys(target)).toEqual([]);
  });

  test("a revoked Proxy throws a TypeError", () => {
    using listener = listen();
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const error = thrownBy(() => listener.getsockname(proxy)) as Error;
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe("Proxy has already been revoked. No more operations are allowed to be performed on it");
  });

  test("the method reads the listener that is its this value", () => {
    using first = listen();
    using second = listen();
    const out = Object.seal({ port: 0 });
    expect(Object.getPrototypeOf(first).getsockname.call(second, out)).toBeUndefined();
    expect(out).toEqual({ port: second.port });
  });

  // The store into a WebAssembly GC reference was an abort, so it runs in a process of its own.
  test("a WebAssembly GC reference throws a TypeError", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `// (module (type $s (struct (field (mut i32)))) (func (export "mk") (result (ref null $s)) struct.new_default $s))
         const bytes = new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0, 1,10,2, 0x5f,1,0x7f,1, 0x60,0,1,0x63,0, 3,2,1,1, 7,6,1,2,0x6d,0x6b,0,0, 10,7,1,5,0,0xfb,1,0,0x0b]);
         const out = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
         const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
         try {
           listener.getsockname(out);
           console.log("did not throw");
         } catch (e) {
           console.log(e.name + ": " + e.message);
         } finally {
           listener.stop(true);
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "TypeError: Cannot set property for WebAssembly GC object\n",
      stderr: "",
      exitCode: 0,
    });
    expect(proc.signalCode).toBeNull();
  });

  // Each of these handles is a listener of Bun.listen(), so each one reaches the same native method.
  describe.each([
    ["Bun.listen({ tls })", () => Bun.listen({ hostname: "127.0.0.1", port: 0, tls: tlsCert, socket: { data() {} } })],
    ["net.Server", () => net.createServer()],
    ["tls.Server", () => tls.createServer(tlsCert)],
    ["http2.createServer()", () => http2.createServer()],
    ["http2.createSecureServer()", () => http2.createSecureServer(tlsCert)],
  ])("through the handle of %s", (_, create) => {
    async function open() {
      const created = create();
      if (!(created instanceof net.Server)) {
        return { handle: created as any, port: created.port, close: () => created.stop(true) };
      }
      created.listen(0, "127.0.0.1");
      await once(created, "listening");
      const { port } = created.address() as net.AddressInfo;
      return { handle: (created as any)._handle, port, close: () => void created.close() };
    }

    test("a frozen object is not changed and a Proxy gets the set traps", async () => {
      const { handle, port, close } = await open();
      try {
        const frozen = Object.freeze({});
        expect(handle.getsockname(frozen)).toBeUndefined();
        expect(Reflect.ownKeys(frozen)).toEqual([]);
        expect(Object.isFrozen(frozen)).toBe(true);

        const calls: unknown[] = [];
        const out = new Proxy(
          {},
          {
            set(target, key, value) {
              calls.push([key, value]);
              return Reflect.set(target, key, value);
            },
          },
        );
        expect(handle.getsockname(out)).toBeUndefined();
        expect(calls).toEqual([
          ["family", "IPv4"],
          ["address", "127.0.0.1"],
          ["port", port],
        ]);
      } finally {
        close();
      }
    });
  });
});
