import { bunEnv, bunExe, tempDir } from "harness";
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BroadcastChannel, markAsUncloneable, MessageChannel, Worker } from "node:worker_threads";

// Helper: assert the given thunk throws a DataCloneError DOMException.
function expectDataCloneError(thunk: () => void) {
  let err: unknown;
  try {
    thunk();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  // Node uses `DOMException` with name "DataCloneError".
  expect((err as { name?: string }).name).toBe("DataCloneError");
}

describe("node:worker_threads.markAsUncloneable", () => {
  test("is a function with arity 1", () => {
    expect(typeof markAsUncloneable).toBe("function");
    expect(markAsUncloneable.length).toBe(1);
  });

  test("is exported on the default export too", () => {
    const wt = require("node:worker_threads");
    expect(wt.markAsUncloneable).toBe(markAsUncloneable);
  });

  test("is exported on the bare 'worker_threads' specifier too", () => {
    const bare = require("worker_threads");
    expect(bare.markAsUncloneable).toBe(markAsUncloneable);
  });

  test("returns undefined", () => {
    expect(markAsUncloneable({})).toBeUndefined();
  });

  test("is a no-op on primitives and null/undefined", () => {
    expect(() => markAsUncloneable(1)).not.toThrow();
    expect(() => markAsUncloneable(0)).not.toThrow();
    expect(() => markAsUncloneable(Number.NaN)).not.toThrow();
    expect(() => markAsUncloneable(true)).not.toThrow();
    expect(() => markAsUncloneable(false)).not.toThrow();
    expect(() => markAsUncloneable("x")).not.toThrow();
    expect(() => markAsUncloneable("")).not.toThrow();
    expect(() => markAsUncloneable(null)).not.toThrow();
    expect(() => markAsUncloneable(undefined)).not.toThrow();
    expect(() => markAsUncloneable(Symbol())).not.toThrow();
    expect(() => markAsUncloneable(0n)).not.toThrow();
    // Zero-arg: also a no-op per Node spec (arg defaults to undefined).
    expect(() => (markAsUncloneable as () => void)()).not.toThrow();
  });

  test("accepts a function as the argument (typeof === 'function')", () => {
    const fn = () => {};
    expect(() => markAsUncloneable(fn)).not.toThrow();
    expectDataCloneError(() => structuredClone(fn));
  });

  test("structuredClone(marked) throws DataCloneError", () => {
    const obj = { foo: "bar" };
    markAsUncloneable(obj);
    expectDataCloneError(() => structuredClone(obj));
  });

  test("structuredClone catches marked object nested inside an array", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    const outer = [1, 2, inner, 4];
    expectDataCloneError(() => structuredClone(outer));
  });

  test("structuredClone catches marked object nested inside an object", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    const outer = { a: 1, wrapper: { nested: inner } };
    expectDataCloneError(() => structuredClone(outer));
  });

  test("structuredClone catches a marked array at the root", () => {
    const arr: unknown[] = [1, 2, 3];
    markAsUncloneable(arr);
    expectDataCloneError(() => structuredClone(arr));
  });

  test("structuredClone catches a marked array nested inside an object", () => {
    const arr: unknown[] = [1, 2, 3];
    markAsUncloneable(arr);
    const outer = { items: arr };
    expectDataCloneError(() => structuredClone(outer));
  });

  test("structuredClone catches marked object nested inside a Map value", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    const map = new Map<string, unknown>([["k", inner]]);
    expectDataCloneError(() => structuredClone(map));
  });

  test("structuredClone catches marked object nested inside a Set", () => {
    const inner = { secret: 1 };
    markAsUncloneable(inner);
    const set = new Set<unknown>([inner]);
    expectDataCloneError(() => structuredClone(set));
  });

  test("MessageChannel: port1.postMessage(marked) throws DataCloneError", () => {
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
    const obj: Record<string, unknown> = { x: 1 };
    markAsUncloneable(obj);
    expectDataCloneError(
      () =>
        new Worker("postMessage('hi')", {
          eval: true,
          workerData: obj,
        }),
    );
  });

  test("ArrayBuffer is unaffected by markAsUncloneable (Node spec no-op)", () => {
    const buf = new ArrayBuffer(8);
    markAsUncloneable(buf);
    const cloned = structuredClone(buf);
    expect(cloned).toBeInstanceOf(ArrayBuffer);
    expect(cloned.byteLength).toBe(8);
    expect(cloned).not.toBe(buf);
  });

  test("SharedArrayBuffer is unaffected by markAsUncloneable (Node spec no-op)", () => {
    const sab = new SharedArrayBuffer(8);
    markAsUncloneable(sab);
    // Node spec: markAsUncloneable has no effect on SharedArrayBuffer. We
    // only assert that cloning does NOT throw DataCloneError — Bun's
    // structuredClone handling of SAB itself is outside the scope of this PR,
    // so we catch any thrown error and only fail on a DataCloneError name.
    let err: unknown;
    try {
      structuredClone(sab);
    } catch (e) {
      err = e;
    }
    expect((err as { name?: string } | undefined)?.name).not.toBe("DataCloneError");
  });

  test("Buffer is unaffected by markAsUncloneable (Node spec no-op)", () => {
    const b = Buffer.from("hello");
    markAsUncloneable(b);
    const cloned = structuredClone(b);
    expect(cloned).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(cloned).toString("utf8")).toBe("hello");
  });

  test("Uint8Array / TypedArrays are unaffected by markAsUncloneable (Node spec no-op)", () => {
    const u8 = new Uint8Array([1, 2, 3, 4]);
    markAsUncloneable(u8);
    const cloned = structuredClone(u8);
    expect(Array.from(cloned)).toEqual([1, 2, 3, 4]);
  });

  test("DataView is unaffected by markAsUncloneable (Node spec no-op)", () => {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, 0xdeadbeef);
    markAsUncloneable(view);
    const cloned = structuredClone(view);
    expect(cloned).toBeInstanceOf(DataView);
    expect(cloned.getUint32(0)).toBe(0xdeadbeef);
  });

  test("marking is irreversible: a second clone still throws", () => {
    const obj = { z: 1 };
    markAsUncloneable(obj);
    expectDataCloneError(() => structuredClone(obj));
    expectDataCloneError(() => structuredClone(obj));
  });

  test("marked object remains usable locally", () => {
    const obj: Record<string, unknown> = { a: 1, b: "two", c: [3, 4] };
    markAsUncloneable(obj);

    expect(obj.a).toBe(1);
    expect(obj.b).toBe("two");
    obj.d = true;
    expect(obj.d).toBe(true);
    delete obj.a;
    expect("a" in obj).toBe(false);
  });

  test("the uncloneable marker is hidden from enumeration APIs", () => {
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

  test("child worker: markAsUncloneable works inside a worker thread too", async () => {
    using dir = tempDir("markAsUncloneable-child-worker", {
      "worker.mjs": `
        import { parentPort, markAsUncloneable } from "node:worker_threads";
        const obj = { fromChild: true };
        markAsUncloneable(obj);
        let threw = false;
        let name = "";
        try {
          structuredClone(obj);
        } catch (e) {
          threw = true;
          name = e.name;
        }
        parentPort.postMessage({ threw, name });
      `,
    });

    // Build the file:// URL via pathToFileURL in the parent scope so paths
    // with spaces or Windows drive letters (file:///C:/…) are handled
    // correctly, then inject the finished URL string into the -e script.
    const workerUrl = pathToFileURL(join(String(dir), "worker.mjs")).href;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const w = new Worker(${JSON.stringify(workerUrl)});
        w.on("message", m => {
          console.log(JSON.stringify(m));
          w.terminate();
        });
        w.on("error", e => {
          console.error("worker error:", e);
          process.exit(1);
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr may contain benign debug-build / ASAN warnings; we only care
    // that no error from the worker itself made it through.
    expect(stderr).not.toContain("worker error:");
    expect(stdout.trim()).toBe(JSON.stringify({ threw: true, name: "DataCloneError" }));
    // Surface full stderr if the child exited non-zero for any other reason,
    // so CI logs show the actual diff rather than just "expected 0 got N".
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
