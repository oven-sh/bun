import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import v8 from "node:v8";
import wt, { BroadcastChannel, markAsUncloneable, MessageChannel, Worker } from "node:worker_threads";

// https://github.com/oven-sh/bun/issues/29423
describe("markAsUncloneable", () => {
  function expectDataCloneError(thunk: () => unknown) {
    let err: unknown;
    try {
      thunk();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { name?: string }).name).toBe("DataCloneError");
  }

  test("is exported as a function", () => {
    expect(typeof markAsUncloneable).toBe("function");
    expect(markAsUncloneable.name).toBe("markAsUncloneable");
    expect(markAsUncloneable.length).toBe(1);
    expect(wt.markAsUncloneable).toBe(markAsUncloneable);
  });

  test("returns undefined", () => {
    expect(markAsUncloneable({})).toBeUndefined();
  });

  test("no-op on primitives, null, and undefined", () => {
    for (const v of [1, 0, Number.NaN, true, false, "x", "", null, undefined, Symbol(), 0n]) {
      expect(() => (markAsUncloneable as any)(v)).not.toThrow();
    }
    expect(() => (markAsUncloneable as any)()).not.toThrow();
  });

  test("structuredClone(marked) throws DataCloneError", () => {
    const obj = { foo: "bar" };
    markAsUncloneable(obj);
    expectDataCloneError(() => structuredClone(obj));
  });

  test("catches marked object nested inside an array", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    expectDataCloneError(() => structuredClone([1, 2, inner, 4]));
  });

  test("catches marked object nested inside an object", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    expectDataCloneError(() => structuredClone({ a: 1, wrapper: { nested: inner } }));
  });

  // In Node.js, V8's ValueSerializer handles Array/Map/Set/Date/RegExp and
  // primitive-wrapper objects before ever consulting the delegate that reads
  // the uncloneable marker, so marking them is effectively a no-op.
  test("marked Array / Map / Set / Date / RegExp / wrapper objects still clone", () => {
    const arr: unknown[] = [1, 2, 3];
    markAsUncloneable(arr);
    expect(structuredClone(arr)).toEqual([1, 2, 3]);
    expect(structuredClone({ x: arr })).toEqual({ x: [1, 2, 3] });

    const m = new Map([["k", "v"]]);
    markAsUncloneable(m);
    expect(structuredClone(m)).toEqual(new Map([["k", "v"]]));

    const s = new Set([1, 2]);
    markAsUncloneable(s);
    expect(structuredClone(s)).toEqual(new Set([1, 2]));

    const d = new Date(12345);
    markAsUncloneable(d);
    expect(structuredClone(d).getTime()).toBe(12345);

    const r = /abc/g;
    markAsUncloneable(r);
    expect(structuredClone(r).source).toBe("abc");

    const bo = new Boolean(true);
    markAsUncloneable(bo);
    expect(structuredClone(bo).valueOf()).toBe(true);
  });

  test("marked WebAssembly.Module / Memory still clone", () => {
    const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const mod = new WebAssembly.Module(bytes);
    markAsUncloneable(mod);
    const { port1, port2 } = new MessageChannel();
    try {
      expect(() => port1.postMessage(mod)).not.toThrow();
    } finally {
      port1.close();
      port2.close();
    }

    const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    markAsUncloneable(mem);
    const { port1: p1, port2: p2 } = new MessageChannel();
    try {
      expect(() => p1.postMessage(mem)).not.toThrow();
    } finally {
      p1.close();
      p2.close();
    }
  });

  test("catches a marked Error instance", () => {
    const err = new Error("boom");
    markAsUncloneable(err);
    expectDataCloneError(() => structuredClone(err));
  });

  // In Node.js, Blob/File/DOMException/CryptoKey/KeyObject/X509Certificate are
  // JS-layer JSTransferable wrappers whose transfer_mode_private_symbol is
  // overwritten by markAsUncloneable, so they throw when cloned.
  test("catches a marked Blob / File / DOMException", () => {
    const blob = new Blob(["x"]);
    markAsUncloneable(blob);
    expectDataCloneError(() => structuredClone(blob));

    const file = new File(["x"], "a.txt");
    markAsUncloneable(file);
    expectDataCloneError(() => structuredClone(file));

    const dex = new DOMException("msg", "AbortError");
    markAsUncloneable(dex);
    expectDataCloneError(() => structuredClone(dex));
  });

  test("catches a marked CryptoKey", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    markAsUncloneable(key);
    expectDataCloneError(() => structuredClone(key));
  });

  test("catches a marked object inside a Map value", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    expectDataCloneError(() => structuredClone(new Map([["k", inner]])));
  });

  test("catches a marked object inside a Set", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    expectDataCloneError(() => structuredClone(new Set([inner])));
  });

  test("catches a marked class instance", () => {
    class Foo {}
    const obj = new Foo();
    markAsUncloneable(obj);
    expectDataCloneError(() => structuredClone(obj));
  });

  test("MessagePort.postMessage(marked) throws DataCloneError", () => {
    const { port1, port2 } = new MessageChannel();
    try {
      const obj = { x: 1 };
      markAsUncloneable(obj);
      expectDataCloneError(() => port1.postMessage(obj));
    } finally {
      port1.close();
      port2.close();
    }
  });

  test("BroadcastChannel.postMessage(marked) throws DataCloneError", () => {
    const bc = new BroadcastChannel("markAsUncloneable-test");
    try {
      const obj = { x: 1 };
      markAsUncloneable(obj);
      expectDataCloneError(() => bc.postMessage(obj));
    } finally {
      bc.close();
    }
  });

  test("new Worker with marked workerData throws DataCloneError", () => {
    const obj = { x: 1 };
    markAsUncloneable(obj);
    expectDataCloneError(() => new Worker("", { eval: true, workerData: obj }));
  });

  test("ArrayBuffer is unaffected", () => {
    const buf = new ArrayBuffer(8);
    markAsUncloneable(buf);
    const cloned = structuredClone(buf);
    expect(cloned).toBeInstanceOf(ArrayBuffer);
    expect(cloned.byteLength).toBe(8);
    expect(cloned).not.toBe(buf);
  });

  test("Buffer / TypedArray / DataView are unaffected", () => {
    const b = Buffer.from("hello");
    markAsUncloneable(b);
    expect(Buffer.from(structuredClone(b)).toString("utf8")).toBe("hello");

    const u8 = new Uint8Array([1, 2, 3, 4]);
    markAsUncloneable(u8);
    expect(Array.from(structuredClone(u8))).toEqual([1, 2, 3, 4]);

    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, 0xdeadbeef);
    markAsUncloneable(dv);
    expect(structuredClone(dv).getUint32(0)).toBe(0xdeadbeef);
  });

  test("marking is irreversible", () => {
    const obj = { z: 1 };
    markAsUncloneable(obj);
    expectDataCloneError(() => structuredClone(obj));
    expectDataCloneError(() => structuredClone(obj));
  });

  test("marker is hidden from enumeration APIs", () => {
    const obj = { visible: 42 };
    markAsUncloneable(obj);

    expect(Object.keys(obj)).toEqual(["visible"]);
    expect(Object.getOwnPropertyNames(obj)).toEqual(["visible"]);
    expect(Object.getOwnPropertySymbols(obj)).toEqual([]);
    expect(Reflect.ownKeys(obj)).toEqual(["visible"]);
    expect(JSON.stringify(obj)).toBe('{"visible":42}');

    const seen: string[] = [];
    for (const key in obj) seen.push(key);
    expect(seen).toEqual(["visible"]);
  });

  // The marker is a JSC private name, not the public "isUncloneable" string;
  // putDirect writes own storage directly without invoking user setters.
  test("does not collide with user properties or invoke user getters/setters", () => {
    let fired = "";

    const withAccessor: Record<string, unknown> = {};
    Object.defineProperty(withAccessor, "isUncloneable", {
      get() {
        fired = "get";
        throw new Error("getter");
      },
      set() {
        fired = "set";
        throw new Error("setter");
      },
      configurable: true,
    });
    expect(() => markAsUncloneable(withAccessor)).not.toThrow();
    expect(fired).toBe("");
    expectDataCloneError(() => structuredClone(withAccessor));
    expect(fired).toBe("");
  });

  // Node.js throws "TypeError: Cannot pass private property name to proxy
  // trap" here (V8 refuses to route private-symbol access through a Proxy at
  // all). Bun's putDirect is non-virtual and writes the ProxyObject's own
  // storage directly, so the call succeeds without invoking any handler trap.
  // Either way no user code runs; the only observable difference is whether
  // the call itself throws.
  test("does not invoke Proxy handler traps", () => {
    let fired = "";
    const proxied = new Proxy(
      {},
      {
        defineProperty() {
          fired = "defineProperty";
          throw new Error("trap");
        },
        set() {
          fired = "set";
          throw new Error("trap");
        },
      },
    );
    try {
      markAsUncloneable(proxied);
    } catch {}
    expect(fired).toBe("");
  });

  test("marked object remains usable locally", () => {
    const obj: Record<string, unknown> = { a: 1, b: "two" };
    markAsUncloneable(obj);

    expect(obj.a).toBe(1);
    obj.c = true;
    expect(obj.c).toBe(true);
    delete obj.a;
    expect("a" in obj).toBe(false);
  });

  test("unmarked objects still clone normally", () => {
    const obj = { a: 1, b: [2, 3] };
    const cloned = structuredClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
  });

  // In Node.js, v8.serialize uses a separate ValueSerializer delegate that
  // never reads the uncloneable marker, so it succeeds on marked objects.
  test("node:v8.serialize ignores the marker", () => {
    const obj = { a: 1 };
    markAsUncloneable(obj);
    const buf = v8.serialize(obj);
    expect(v8.deserialize(buf)).toEqual({ a: 1 });
  });

  // Node's child_process `serialization: "advanced"` uses v8.DefaultSerializer,
  // the same delegate as v8.serialize, so it also ignores the marker.
  test("child_process advanced IPC ignores the marker", async () => {
    using dir = tempDir("markAsUncloneable-ipc", {
      "child.js": `
        process.on("message", m => {
          process.send({ echo: m });
        });
      `,
    });
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "child.js")],
      env: bunEnv,
      serialization: "advanced",
      ipc(message) {
        resolve(message);
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.exited.then(code => reject(new Error("child exited early: " + code)));
    const obj = { a: 1 };
    markAsUncloneable(obj);
    expect(() => proc.send(obj)).not.toThrow();
    const received = await promise;
    expect(received).toEqual({ echo: { a: 1 } });
  });

  test("works on frozen / sealed / non-extensible objects", () => {
    const frozen = Object.freeze({ a: 1 });
    markAsUncloneable(frozen);
    expectDataCloneError(() => structuredClone(frozen));
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Reflect.ownKeys(frozen)).toEqual(["a"]);

    const sealed = Object.seal({ b: 2 });
    markAsUncloneable(sealed);
    expectDataCloneError(() => structuredClone(sealed));
    expect(Object.isSealed(sealed)).toBe(true);

    const nonext = Object.preventExtensions({ c: 3 });
    markAsUncloneable(nonext);
    expectDataCloneError(() => structuredClone(nonext));
    expect(Object.isExtensible(nonext)).toBe(false);
  });

  test("works inside a worker thread", async () => {
    const script = `
      const { parentPort, markAsUncloneable } = require("node:worker_threads");
      const obj = { fromChild: true };
      markAsUncloneable(obj);
      let name = "";
      try { structuredClone(obj); } catch (e) { name = e.name; }
      parentPort.postMessage({ name });
    `;
    const worker = new Worker(script, { eval: true });
    try {
      const result = await new Promise((resolve, reject) => {
        worker.on("message", resolve);
        worker.on("error", reject);
      });
      expect(result).toEqual({ name: "DataCloneError" });
    } finally {
      await worker.terminate();
    }
  });
});
