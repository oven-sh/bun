import { structuredCloneAdvanced } from "bun:internal-for-testing";
import { deserialize, estimateShallowMemoryUsageOf, serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, rss } from "harness";
import { MessageChannel as NodeMessageChannel, Worker as NodeWorker, receiveMessageOnPort } from "node:worker_threads";

describe("Structured Clone Fast Path", () => {
  test("structuredClone should work with empty object", () => {
    const object = {};
    const cloned = structuredClone(object);
    expect(cloned).toStrictEqual({});
  });

  test("structuredClone({}) result is spreadable after adding a property", () => {
    // The fast-path deserializer sized the clone with inline capacity 0 for an
    // empty source, so spreading it tripped JSC's hasInlineStorage() debug
    // assert once a property was added.
    const x: Record<string, number> = structuredClone({});
    x.a = 1;
    expect({ ...x }).toEqual({ a: 1 });

    const [y]: Record<string, number>[] = structuredClone([{}]);
    y.b = 2;
    expect({ ...y }).toEqual({ b: 2 });
  });

  test("structuredClone should work with empty string", () => {
    const string = "";
    const cloned = structuredClone(string);
    expect(cloned).toStrictEqual("");
  });

  describe("primitive root", () => {
    // [name, value]. The string in each pair keeps the number beside it in its own encoding, int32 or double.
    const primitives: [string, unknown][] = [
      ["42", 42],
      ["0", 0],
      ["int32 max", 2147483647],
      ["int32 min", -2147483648],
      ["int32 max + 1", 2147483648],
      ["3.14", 3.14],
      ["-0", -0],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["true", true],
      ["false", false],
      ["null", null],
      ["undefined", undefined],
    ];
    // Tells -0 from 0 and null from undefined, also in a failure message.
    const tag = (value: unknown) => (Object.is(value, -0) ? "number -0" : `${typeof value} ${String(value)}`);
    const tags = primitives.map(([, value]) => tag(value));
    const wireBytes = (value: unknown) => Buffer.from(serialize(value)).toString("hex");
    const thrownBy = (fn: () => unknown) => {
      try {
        fn();
      } catch (error: any) {
        return { name: error.name, code: error.code };
      }
      return "did not throw";
    };
    type CloneOptions = Parameters<typeof structuredClone>[1];
    // Not folded when the file is transpiled.
    const zero = Number("0");
    // A Float64Array read gives a double, also for an integer.
    const double = (value: number) => new Float64Array([value])[0];
    // The primitives, and numbers that the deserializer returns in another encoding or with other bits.
    const encodings: [string, unknown][] = [
      ...primitives,
      ["double 0", double(0)],
      ["double 1", double(1)],
      ["double 5", double(5)],
      ["double -1", double(-1)],
      ["double int32 max", double(2147483647)],
      ["double int32 min", double(-2147483648)],
      ["double int32 max + 1", double(2147483648)],
      ["double int32 min - 1", double(-2147483649)],
      ["zero / zero", zero / zero],
      ["-(zero / zero)", -(zero / zero)],
      ["Math.sqrt(-1)", Math.sqrt(zero - 1)],
    ];

    test("structuredClone returns the value for every form of empty options", () => {
      const emptyOptions = [undefined, null, {}, { transfer: [] }] as CloneOptions[];
      for (const [, value] of primitives) {
        expect(tag(structuredClone(value))).toBe(tag(value));
        for (const options of emptyOptions) expect(tag(structuredClone(value, options))).toBe(tag(value));
      }
    });

    test("the record of a posted primitive holds no serialized bytes", async () => {
      const { port1, port2 } = new MessageChannel();
      try {
        const costs: number[] = [];
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        port2.onmessageerror = reject;
        port2.onmessage = event => {
          costs.push(estimateShallowMemoryUsageOf(event));
          if (costs.length === primitives.length + 2) resolve();
        };
        for (const [, value] of primitives) port1.postMessage(value);
        port1.postMessage("");
        port1.postMessage(new Map());
        await promise;
        // The estimate for an event includes the bytes that its message record holds: none for "", the wire bytes for a Map.
        const map = costs.pop()!;
        const emptyString = costs.pop()!;
        expect(emptyString).toBeLessThan(map);
        expect(costs).toEqual(primitives.map(() => emptyString));
      } finally {
        port1.close();
        port2.close();
      }
    });

    // Without ASAN, malloc is mimalloc, so heapStats() counts every allocation. A debug build takes 0.1 s for each
    // heapStats() call.
    test.skipIf(isASAN || isDebug)(
      "structuredClone of a primitive allocates nothing, and a posted primitive allocates what a posted '' does",
      async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
            const { heapStats } = require("bun:jsc");
            const { MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
            const count = () => heapStats().mimalloc.malloc_normal_count;
            // The fewest of 7 rounds: heapStats() and the other threads only add to a count.
            const perCall = fn => {
              let fewest = Infinity;
              for (let round = 0; round < 7; round++) {
                const before = count();
                for (let i = 0; i < 1000; i++) fn();
                fewest = Math.min(fewest, count() - before);
              }
              return Math.round(fewest / 1000);
            };
            const { port1, port2 } = new MessageChannel();
            const post = value => () => {
              port1.postMessage(value);
              receiveMessageOnPort(port2);
            };
            const map = new Map();
            const counts = { clone: {}, post: {} };
            for (const [name, value] of [["42", 42], ["1.5", 1.5], ["true", true], ["null", null], ["undefined", undefined]]) {
              counts.clone[name] = perCall(() => structuredClone(value));
              counts.post[name] = perCall(post(value));
            }
            // Shows that the counter sees the serializer and the record of a message.
            counts.cloneMap = perCall(() => structuredClone(map));
            counts.postEmptyString = perCall(post(""));
            port1.close();
            port2.close();
            console.log(JSON.stringify(counts));
          `,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        const { cloneMap, postEmptyString, ...counts } = JSON.parse(stdout);
        expect(cloneMap).toBeGreaterThan(0);
        expect(postEmptyString).toBeGreaterThan(0);
        const each = (count: number) => ({
          "42": count,
          "1.5": count,
          "true": count,
          "null": count,
          "undefined": count,
        });
        expect(counts).toEqual({ clone: each(0), post: each(postEmptyString) });
        expect(exitCode).toBe(0);
      },
    );

    test("a number arrives with the encoding and the bits that the serializer gives it", () => {
      // bun:jsc serialize writes an int32 and a double differently, and writes the bits of a double as they are.
      expect(wireBytes(double(5))).not.toBe(wireBytes(5));
      // One of the two is not the NaN that the deserializer returns. Which one depends on the CPU.
      expect(wireBytes(zero / zero)).not.toBe(wireBytes(-(zero / zero)));

      const { port1, port2 } = new MessageChannel();
      try {
        for (const [name, value] of encodings) {
          // A transfer list sends the value through the serializer.
          const serialized = wireBytes(structuredClone(value, { transfer: [new ArrayBuffer(1)] }));
          port1.postMessage(value);
          expect({
            name,
            structuredClone: wireBytes(structuredClone(value)),
            port: wireBytes(receiveMessageOnPort(port2)!.message),
          }).toEqual({ name, structuredClone: serialized, port: serialized });
        }
      } finally {
        port1.close();
        port2.close();
      }
    });

    test("a MessageChannel delivers the value", async () => {
      const { port1, port2 } = new MessageChannel();
      try {
        const received: string[] = [];
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        port2.onmessageerror = reject;
        port2.onmessage = event => {
          received.push(tag(event.data));
          if (received.length === primitives.length) resolve();
        };
        for (const [, value] of primitives) port1.postMessage(value);
        await promise;
        expect(received).toEqual(tags);
      } finally {
        port1.close();
        port2.close();
      }
    });

    test("receiveMessageOnPort tells a posted undefined from an empty queue", () => {
      const { port1, port2 } = new MessageChannel();
      try {
        expect(receiveMessageOnPort(port2)).toBeUndefined();
        for (const [, value] of primitives) port1.postMessage(value);
        const received = primitives.map(() => receiveMessageOnPort(port2));
        expect(received.map(entry => entry && tag(entry.message))).toEqual(tags);
        expect(receiveMessageOnPort(port2)).toBeUndefined();
      } finally {
        port1.close();
        port2.close();
      }
    });

    test("a port keeps the post order of primitives and objects", async () => {
      const { port1, port2 } = new MessageChannel();
      try {
        const sent = [1, { a: 1 }, null, "s", undefined, [1], false];
        // The messages wait in the queue until the port starts.
        for (const value of sent) port1.postMessage(value);
        const received: unknown[] = [];
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        port2.addEventListener("messageerror", reject);
        port2.addEventListener("message", event => {
          received.push(event.data);
          if (received.length === sent.length) resolve();
        });
        port2.start();
        await promise;
        expect(received).toStrictEqual(sent);
      } finally {
        port1.close();
        port2.close();
      }
    });

    test("primitives posted before close() arrive before the 'close' event", async () => {
      const { port1, port2 } = new NodeMessageChannel();
      try {
        const received: string[] = [];
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        port2.on("messageerror", reject);
        port2.on("message", message => received.push(tag(message)));
        port2.on("close", resolve);
        port1.postMessage(1);
        port1.postMessage(true);
        port1.postMessage(null);
        port1.close();
        await promise;
        expect(received).toEqual(["number 1", "boolean true", "object null"]);
      } finally {
        port2.close();
      }
    });

    test("primitives queued on a port arrive after the port is transferred", async () => {
      const inner = new NodeMessageChannel();
      const outer = new NodeMessageChannel();
      let transferred: typeof inner.port2 | undefined;
      try {
        inner.port1.postMessage(1);
        inner.port1.postMessage(false);
        inner.port1.postMessage(null);
        outer.port1.postMessage(inner.port2, [inner.port2]);
        const { promise, resolve, reject } = Promise.withResolvers<string[]>();
        outer.port2.on("messageerror", reject);
        outer.port2.on("message", port => {
          transferred = port;
          const received: string[] = [];
          port.on("messageerror", reject);
          port.on("message", (message: unknown) => {
            received.push(tag(message));
            if (received.length === 3) resolve(received);
          });
        });
        expect(await promise).toEqual(["number 1", "boolean false", "object null"]);
      } finally {
        transferred?.close();
        inner.port1.close();
        outer.port1.close();
        outer.port2.close();
      }
    });

    test("a BroadcastChannel delivers the value to every subscriber", async () => {
      const name = "structured-clone-fastpath primitive root";
      const sender = new BroadcastChannel(name);
      const receivers = [new BroadcastChannel(name), new BroadcastChannel(name)];
      try {
        const received: string[][] = receivers.map(() => []);
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        receivers.forEach((receiver, i) => {
          receiver.onmessageerror = reject;
          receiver.onmessage = event => {
            received[i].push(tag(event.data));
            if (received.every(list => list.length === primitives.length)) resolve();
          };
        });
        for (const [, value] of primitives) sender.postMessage(value);
        await promise;
        expect(received).toEqual([tags, tags]);
      } finally {
        sender.close();
        for (const receiver of receivers) receiver.close();
      }
    });

    test("performance.mark and performance.measure keep a primitive detail", () => {
      for (const [name, value] of primitives) {
        const entryName = `primitive root ${name}`;
        // An undefined detail is an absent one, and an absent detail reads as null.
        const expected = tag(value === undefined ? null : value);
        try {
          const mark = performance.mark(entryName, { detail: value });
          expect([tag(mark.detail), tag(mark.detail)]).toEqual([expected, expected]);
          const measure = performance.measure(entryName, { start: 0, end: 1, detail: value });
          expect([tag(measure.detail), tag(measure.detail)]).toEqual([expected, expected]);
        } finally {
          performance.clearMarks(entryName);
          performance.clearMeasures(entryName);
        }
      }
    });

    test.concurrent("a node:worker_threads worker echoes the value", async () => {
      const worker = new NodeWorker(
        `const { parentPort } = require("node:worker_threads"); parentPort.on("message", message => parentPort.postMessage(message));`,
        { eval: true },
      );
      try {
        const received: string[] = [];
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        worker.on("error", reject);
        worker.on("messageerror", reject);
        worker.on("exit", code => reject(new Error(`the worker exited with code ${code}`)));
        worker.on("message", message => {
          received.push(tag(message));
          if (received.length === primitives.length) resolve();
        });
        for (const [, value] of primitives) worker.postMessage(value);
        await promise;
        expect(received).toEqual(tags);
      } finally {
        await worker.terminate();
      }
    });

    test.concurrent("a web Worker echoes the value", async () => {
      const url = URL.createObjectURL(
        new Blob(["self.onmessage = event => self.postMessage(event.data);"], { type: "text/javascript" }),
      );
      const worker = new Worker(url);
      try {
        const received: string[] = [];
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        worker.onerror = reject;
        worker.onmessageerror = reject;
        worker.onmessage = event => {
          received.push(tag(event.data));
          if (received.length === primitives.length) resolve();
        };
        for (const [, value] of primitives) worker.postMessage(value);
        await promise;
        expect(received).toEqual(tags);
      } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    });

    test.concurrent("a primitive thrown in a worker reaches the 'error' listener", async () => {
      const errors = await Promise.all(
        ["42", "null", "undefined", "false"].map(source => {
          const worker = new NodeWorker(`throw ${source}`, { eval: true });
          const { promise, resolve, reject } = Promise.withResolvers<string>();
          worker.on("error", error => resolve(tag(error)));
          worker.on("exit", code => reject(new Error(`the worker exited with code ${code} and no 'error' event`)));
          return promise;
        }),
      );
      expect(errors).toEqual(["number 42", "object null", "undefined undefined", "boolean false"]);
    });

    test.concurrent("advanced IPC echoes a primitive in both directions", async () => {
      // process.send() refuses undefined before it serializes.
      const sent = primitives.filter(([, value]) => value !== undefined);
      const received: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      await using child = Bun.spawn({
        cmd: [bunExe(), "-e", `process.on("message", message => process.send(message));`],
        env: bunEnv,
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "advanced",
        ipc(message) {
          received.push(tag(message));
          if (received.length === sent.length) resolve();
        },
        onExit(_child, exitCode, signalCode) {
          reject(new Error(`the child exited (${exitCode}, ${signalCode}) after ${received.length} messages`));
        },
      });
      for (const [, value] of sent) child.send(value);
      await promise;
      expect(received).toEqual(sent.map(([, value]) => tag(value)));
    });

    test("structuredCloneAdvanced returns what the serializer returns in every context", () => {
      // With forStorage the value goes through the serializer.
      const serialized = encodings.map(([, value]) =>
        wireBytes(structuredCloneAdvanced(value, [], false, true, "default")),
      );
      for (const context of ["default", "worker", "window"] as const) {
        for (const forTransfer of [false, true]) {
          for (const forStorage of [false, true]) {
            const cloned = encodings.map(([, value]) =>
              wireBytes(structuredCloneAdvanced(value, [], forTransfer, forStorage, context)),
            );
            expect({ context, forTransfer, forStorage, cloned }).toEqual({
              context,
              forTransfer,
              forStorage,
              cloned: serialized,
            });
          }
        }
      }
    });

    test("bun:jsc serialize writes wire bytes for a primitive", () => {
      for (const [, value] of primitives) {
        const bytes = serialize(value);
        expect(bytes.byteLength).toBeGreaterThan(0);
        expect(tag(deserialize(bytes))).toBe(tag(value));
      }
    });

    test("a transfer list is validated and detached as before", () => {
      const buffer = new ArrayBuffer(8);
      expect(structuredClone(42, { transfer: [buffer] })).toBe(42);
      expect(buffer.detached).toBe(true);

      const twice = new ArrayBuffer(8);
      expect(thrownBy(() => structuredClone(42, { transfer: [twice, twice] }))).toEqual({
        name: "DataCloneError",
        code: 25,
      });
      expect(twice.detached).toBe(false);
      expect(thrownBy(() => structuredClone(42, { transfer: [{} as ArrayBuffer] }))).toEqual({
        name: "DataCloneError",
        code: 25,
      });
      expect(() => structuredClone(42, 5 as unknown as CloneOptions)).toThrow(TypeError);
      // @ts-expect-error structuredClone needs an argument
      expect(() => structuredClone()).toThrow("structuredClone requires 1 argument");

      let reads = 0;
      const options = {
        get transfer() {
          reads++;
          return [];
        },
      };
      expect(structuredClone(7, options)).toBe(7);
      expect(reads).toBe(1);

      const { port1, port2 } = new MessageChannel();
      try {
        const posted = new ArrayBuffer(8);
        port1.postMessage(1, [posted]);
        expect(posted.detached).toBe(true);
        expect(receiveMessageOnPort(port2)).toEqual({ message: 1 });
      } finally {
        port1.close();
        port2.close();
      }
    });

    test("a symbol throws DataCloneError and a bigint is cloned, as before", () => {
      expect(thrownBy(() => structuredClone(Symbol("s")))).toEqual({ name: "DataCloneError", code: 25 });
      for (const value of [0n, 1n, -1n, 2147483647n, -2147483648n, 2n ** 80n, -(2n ** 80n)]) {
        expect(structuredClone(value)).toBe(value);
      }
    });
  });

  const deOptimizations = [
    {
      get accessor() {
        return 1;
      },
    },
    Object.create(Object.prototype, {
      data: {
        value: 1,
        writable: false,
        configurable: false,
      },
    }),
    Object.create(Object.prototype, {
      data: {
        value: 1,
        writable: true,
        configurable: false,
      },
    }),
    Object.create(Object.prototype, {
      data: {
        get: () => 1,
        configurable: true,
      },
    }),
    Object.create(Object.prototype, {
      data: {
        set: () => {},
        enumerable: true,
        configurable: true,
      },
    }),
  ];

  for (const deOptimization of deOptimizations) {
    test("structuredCloneDeOptimization", () => {
      structuredClone(deOptimization);
    });
  }

  test("structuredClone should use a constant amount of memory for string inputs", () => {
    const clones: Array<string> = [];
    // Create a 512KB string to test fast path
    const largeString = Buffer.alloc(512 * 1024, "a").toString();
    for (let i = 0; i < 100; i++) {
      clones.push(structuredClone(largeString));
    }
    Bun.gc(true);
    const rss1 = rss();
    for (let i = 0; i < 10000; i++) {
      clones.push(structuredClone(largeString));
    }
    Bun.gc(true);
    const rss2 = rss();
    const delta = rss2 - rss1;
    // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
    // retention inflate RSS even when nothing is leaking.
    expect(delta).toBeLessThan(isASAN ? 1024 * 1024 * 400 : 1024 * 1024 * 8);
    expect(clones.length).toBe(10000 + 100);
  });

  test("structuredClone should use a constant amount of memory for simple object inputs", () => {
    // Create a 512KB string to test fast path
    const largeValue = { property: Buffer.alloc(512 * 1024, "a").toString() };
    for (let i = 0; i < 100; i++) {
      structuredClone(largeValue);
    }
    Bun.gc(true);
    const rss1 = rss();
    for (let i = 0; i < 10000; i++) {
      structuredClone(largeValue);
    }
    Bun.gc(true);
    const rss2 = rss();
    const delta = rss2 - rss1;
    // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
    // retention inflate RSS even when nothing is leaking.
    expect(delta).toBeLessThan(isASAN ? 1024 * 1024 * 400 : 1024 * 1024);
  });

  // === Array fast path tests ===

  test("structuredClone should work with empty array", () => {
    expect(structuredClone([])).toEqual([]);
  });

  test("structuredClone should work with array of numbers", () => {
    const input = [1, 2, 3, 4, 5];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of strings", () => {
    const input = ["hello", "world", ""];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of mixed primitives", () => {
    const input = [1, "hello", true, false, null, undefined, 3.14];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structuredClone should work with array of special numbers", () => {
    const cloned = structuredClone([-0, NaN, Infinity, -Infinity]);
    expect(Object.is(cloned[0], -0)).toBe(true);
    expect(cloned[1]).toBeNaN();
    expect(cloned[2]).toBe(Infinity);
    expect(cloned[3]).toBe(-Infinity);
  });

  test("structuredClone should work with large array of numbers", () => {
    const input = Array.from({ length: 10000 }, (_, i) => i);
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of simple objects", () => {
    const input = [
      { a: 1, b: "hello" },
      { a: 2, b: "world" },
    ];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with large array of same-shape objects", () => {
    const input = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}`, active: i % 2 === 0 }));
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of mixed elements and objects", () => {
    const input = [1, "hello", { a: 1 }, true, { b: "world" }];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of objects with different shapes", () => {
    const input = [{ a: 1 }, { b: "hello", c: true }, { x: 42 }];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should fallback for array with nested objects inside objects", () => {
    // nested object inside object → normal path (still correct)
    const input = [{ a: { b: 1 } }];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone creates independent copies of objects in array", () => {
    const input = [{ a: 1 }, { a: 2 }];
    const cloned = structuredClone(input);
    cloned[0].a = 999;
    expect(input[0].a).toBe(1);
  });

  test("postMessage with array of objects via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("structuredClone should fallback for arrays with holes", () => {
    const input = [1, , 3]; // sparse
    const cloned = structuredClone(input);
    // structured clone spec: holes become undefined
    expect(cloned[0]).toBe(1);
    expect(cloned[1]).toBe(undefined);
    expect(cloned[2]).toBe(3);
  });

  test("structuredClone should work with array of doubles", () => {
    const input = [1.5, 2.7, 3.14, 0.1 + 0.2];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structuredClone creates independent copy of array", () => {
    const input = [1, 2, 3];
    const cloned = structuredClone(input);
    cloned[0] = 999;
    expect(input[0]).toBe(1);
  });

  test("structuredClone should preserve named properties on arrays", () => {
    const input: any = [1, 2, 3];
    input.foo = "bar";
    const cloned = structuredClone(input);
    expect(cloned.foo).toBe("bar");
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
  });

  test("postMessage should work with array fast path", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [1, 2, 3, "hello", true];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  // === Edge case tests ===

  test("structuredClone of frozen array should produce a non-frozen clone", () => {
    const input = Object.freeze([1, 2, 3]);
    const cloned = structuredClone(input) as number[];
    expect(cloned).toEqual([1, 2, 3]);
    expect(Object.isFrozen(cloned)).toBe(false);
    cloned[0] = 999;
    expect(cloned[0]).toBe(999);
  });

  test("structuredClone of sealed array should produce a non-sealed clone", () => {
    const input = Object.seal([1, 2, 3]);
    const cloned = structuredClone(input);
    expect(cloned).toEqual([1, 2, 3]);
    expect(Object.isSealed(cloned)).toBe(false);
    cloned.push(4);
    expect(cloned).toEqual([1, 2, 3, 4]);
  });

  test("structuredClone of array with deleted element (hole via delete)", () => {
    const input = [1, 2, 3];
    delete (input as any)[1];
    const cloned = structuredClone(input);
    expect(cloned[0]).toBe(1);
    expect(cloned[1]).toBe<number | undefined>(undefined);
    expect(cloned[2]).toBe(3);
    expect(1 in cloned).toBe(false); // holes remain holes after structuredClone
  });

  test("structuredClone of array with length > actual elements", () => {
    const input = [1, 2, 3];
    input.length = 6;
    const cloned = structuredClone(input);
    expect(cloned.length).toBe(6);
    expect(cloned[0]).toBe(1);
    expect(cloned[1]).toBe(2);
    expect(cloned[2]).toBe(3);
    expect(cloned[3]).toBe<number | undefined>(undefined);
  });

  test("structuredClone of single element arrays", () => {
    expect(structuredClone([42])).toEqual([42]);
    expect(structuredClone([3.14])).toEqual([3.14]);
    expect(structuredClone(["hello"])).toEqual(["hello"]);
    expect(structuredClone([true])).toEqual([true]);
    expect(structuredClone([null])).toEqual([null]);
  });

  test("structuredClone of array with named properties on Int32 array", () => {
    const input: any = [1, 2, 3]; // Int32 indexing
    input.name = "test";
    input.count = 42;
    const cloned = structuredClone(input);
    expect(cloned.name).toBe("test");
    expect(cloned.count).toBe(42);
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
  });

  test("structuredClone of array with named properties on Double array", () => {
    const input: any = [1.1, 2.2, 3.3]; // Double indexing
    input.label = "doubles";
    const cloned = structuredClone(input);
    expect(cloned.label).toBe("doubles");
    expect(Array.from(cloned)).toEqual([1.1, 2.2, 3.3]);
  });

  test("structuredClone of array that transitions Int32 to Double", () => {
    const input = [1, 2, 3]; // starts as Int32
    input.push(4.5); // transitions to Double
    const cloned = structuredClone(input);
    expect(cloned).toEqual([1, 2, 3, 4.5]);
  });

  test("structuredClone of array with modified prototype", () => {
    const input = [1, 2, 3];
    Object.setPrototypeOf(input, {
      customMethod() {
        return 42;
      },
    });
    const cloned = structuredClone(input);
    // Clone should have standard Array prototype, not the custom one
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
    expect(cloned).toBeInstanceOf(Array);
    expect((cloned as any).customMethod).toBeUndefined();
  });

  test("structuredClone of array with prototype indexed properties and holes", () => {
    const proto = Object.create(Array.prototype);
    proto[1] = "from proto";
    const input = new Array(3);
    Object.setPrototypeOf(input, proto);
    input[0] = "a";
    input[2] = "c";
    // structuredClone only copies own properties; prototype values are not included
    const cloned = structuredClone(input);
    expect(cloned[0]).toBe("a");
    expect(1 in cloned).toBe(false); // hole, not "from proto"
    expect(cloned[2]).toBe("c");
    expect(cloned).toBeInstanceOf(Array);
  });

  test("postMessage with Int32 array via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [10, 20, 30, 40, 50];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("postMessage with Double array via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [1.1, 2.2, 3.3];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("structuredClone of array multiple times produces independent copies", () => {
    const input = [1, 2, 3];
    const clones = Array.from({ length: 10 }, () => structuredClone(input));
    clones[0][0] = 999;
    clones[5][1] = 888;
    // All other clones and the original should be unaffected
    expect(input).toEqual([1, 2, 3]);
    for (let i = 1; i < 10; i++) {
      if (i === 5) {
        expect(clones[i]).toEqual([1, 888, 3]);
      } else {
        expect(clones[i]).toEqual([1, 2, 3]);
      }
    }
  });

  test("structuredClone of Array subclass loses subclass identity", () => {
    class MyArray extends Array<number> {
      customProp = "hello";
      sum() {
        return this.reduce((a: number, b: number) => a + b, 0);
      }
    }
    const input = new MyArray(1, 2, 3);
    input.customProp = "world";
    const cloned = structuredClone(input);
    // structuredClone spec: result is a plain Array, not a subclass
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
    expect(cloned).toBeInstanceOf(Array);
    expect((cloned as any).sum).toBeUndefined();
  });

  test("structuredClone of array with only undefined values", () => {
    const input = [undefined, undefined, undefined];
    const cloned = structuredClone(input);
    expect(cloned).toEqual([undefined, undefined, undefined]);
    expect(cloned.length).toBe(3);
    // Ensure they are actual values, not holes
    expect(0 in cloned).toBe(true);
    expect(1 in cloned).toBe(true);
    expect(2 in cloned).toBe(true);
  });

  test("structuredClone of array with only null values", () => {
    const input = [null, null, null];
    const cloned = structuredClone(input);
    expect(cloned).toEqual([null, null, null]);
  });

  test("structuredClone of dense double array preserves -0 and NaN", () => {
    const input = [-0, NaN, -0, NaN];
    const cloned = structuredClone(input);
    expect(Object.is(cloned[0], -0)).toBe(true);
    expect(cloned[1]).toBeNaN();
    expect(Object.is(cloned[2], -0)).toBe(true);
    expect(cloned[3]).toBeNaN();
  });

  test("structuredClone on object with simple properties can exceed JSFinalObject::maxInlineCapacity", () => {
    let largeValue = {};
    for (let i = 0; i < 100; i++) {
      largeValue["property" + i] = i;
    }

    for (let i = 0; i < 100; i++) {
      expect(structuredClone(largeValue)).toStrictEqual(largeValue);
    }
    Bun.gc(true);
    for (let i = 0; i < 100; i++) {
      expect(structuredClone(largeValue)).toStrictEqual(largeValue);
    }
  });

  // === DenseArray fast path edge case tests ===

  test("array of empty objects", () => {
    const input = [{}, {}, {}];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0]).not.toBe(input[0]);
  });

  test("array with single object element", () => {
    const input = [{ key: "value" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[0].key = "modified";
    expect(input[0].key).toBe("value");
  });

  test("objects with special number property values", () => {
    const input = [{ a: NaN, b: Infinity, c: -Infinity, d: -0 }];
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBeNaN();
    expect(cloned[0].b).toBe(Infinity);
    expect(cloned[0].c).toBe(-Infinity);
    expect(Object.is(cloned[0].d, -0)).toBe(true);
  });

  test("objects with null and undefined property values", () => {
    const input = [
      { a: null, b: undefined },
      { a: null, b: undefined },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0].a).toBeNull();
    expect(cloned[0].b).toBeUndefined();
    expect("b" in cloned[0]).toBe(true);
  });

  test("objects with empty string keys and values", () => {
    const input = [{ "": "" }, { "": "nonempty" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("objects with many properties exceeding maxInlineCapacity", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 100; i++) obj[`p${i}`] = i;
    const input = [obj, { ...obj }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(Object.keys(cloned[0]).length).toBe(100);
  });

  test("alternating object shapes (cache invalidation)", () => {
    // shape A, shape B, shape A, shape B — cache should not corrupt results
    const input = [{ x: 1, y: 2 }, { name: "hello" }, { x: 3, y: 4 }, { name: "world" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("objects followed by primitives followed by objects", () => {
    const input = [{ a: 1 }, 42, null, { b: "two" }, "str", { c: true }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("fallback: array with object containing array property value", () => {
    const input = [{ foo: [1, 2, 3] }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[0].foo[0] = 999;
    expect(input[0].foo[0]).toBe(1);
  });

  test("fallback: array with object containing nested object property value", () => {
    const input = [{ a: 1 }, { b: { nested: true } }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[1].b!.nested = false;
    expect(input[1].b!.nested).toBe(true);
  });

  test("fallback: array with Date object", () => {
    const now = new Date();
    const input = [{ a: 1 }, now];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(cloned[1]).toEqual(now);
    expect(cloned[1]).toBeInstanceOf(Date);
  });

  test("fallback: array with RegExp object", () => {
    const input = [{ a: 1 }, /test/gi];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(cloned[1]).toEqual(/test/gi);
  });

  test("fallback: array with Map", () => {
    const input = [new Map([["key", "value"]])];
    const cloned = structuredClone(input);
    expect(cloned[0].get("key")).toBe("value");
  });

  test("fallback: array with Set", () => {
    const input = [new Set([1, 2, 3])];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual(new Set([1, 2, 3]));
  });

  test("fallback: object with getter in array", () => {
    const obj = Object.defineProperty({}, "x", { get: () => 42, enumerable: true, configurable: true });
    const input = [obj];
    const cloned = structuredClone(input);
    expect((cloned[0] as any).x).toBe(42);
  });

  test("fallback: object with non-enumerable property in array", () => {
    const obj = Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false });
    const input = [obj];
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBe(1);
    // non-enumerable property should not be cloned by structuredClone
    expect((cloned[0] as any).hidden).toBeUndefined();
  });

  test("frozen objects in array produce non-frozen clones", () => {
    const input = [Object.freeze({ a: 1, b: "hello" }), Object.freeze({ a: 2, b: "world" })];
    const cloned = structuredClone(input) as { a: number; b: string }[];
    expect(cloned).toEqual([
      { a: 1, b: "hello" },
      { a: 2, b: "world" },
    ]);
    expect(Object.isFrozen(cloned[0])).toBe(false);
    cloned[0].a = 999;
    expect(cloned[0].a).toBe(999);
  });

  test("sealed objects in array produce non-sealed clones", () => {
    const input = [Object.seal({ x: 10 })];
    const cloned = structuredClone(input);
    expect(cloned).toEqual([{ x: 10 }]);
    expect(Object.isSealed(cloned[0])).toBe(false);
  });

  test("object with numeric string keys in array", () => {
    const input = [{ "0": "a", "1": "b", "2": "c" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("repeated structuredClone of same array of objects", () => {
    const input = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const clones = Array.from({ length: 10 }, () => structuredClone(input));
    // Mutate one clone
    clones[0][0].id = 999;
    clones[3][1].name = "Charlie";
    // Original and other clones unaffected
    expect(input[0].id).toBe(1);
    expect(input[1].name).toBe("Bob");
    expect(clones[1][0].id).toBe(1);
    expect(clones[5][1].name).toBe("Bob");
  });

  test("postMessage with mixed array of objects and primitives", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [42, { x: "hello" }, true, { y: 3.14 }, null];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("postMessage with array of empty objects", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [{}, {}, {}];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("fallback: array with ArrayBuffer", () => {
    const buf = new ArrayBuffer(8);
    new Uint8Array(buf).set([1, 2, 3, 4, 5, 6, 7, 8]);
    const input = [{ a: 1 }, buf];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(new Uint8Array(cloned[1] as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  test("fallback: object created with Object.create(null) in array", () => {
    const obj = Object.create(null);
    obj.a = 1;
    obj.b = "hello";
    const input = [obj];
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBe(1);
    expect(cloned[0].b).toBe("hello");
  });

  test("fallback: class instance in array", () => {
    class Foo {
      constructor(public x: number) {}
    }
    const input = [new Foo(42)];
    const cloned = structuredClone(input);
    expect(cloned[0].x).toBe(42);
    expect(cloned[0]).not.toBeInstanceOf(Foo);
  });

  test("object with boolean property values in array", () => {
    const input = [
      { enabled: true, visible: false },
      { enabled: false, visible: true },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0].enabled).toBe(true);
    expect(cloned[1].visible).toBe(true);
  });

  test("object with only string values in array", () => {
    const input = [
      { first: "Alice", last: "Smith" },
      { first: "Bob", last: "Jones" },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("large array of objects with same shape (structure cache stress)", () => {
    const input = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `v${i}` }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[500].id = -1;
    expect(input[500].id).toBe(500);
  });

  // === Additional DenseArray edge case tests ===

  test("shared object reference in source array preserves identity", () => {
    const shared = { x: 1, y: "hello" };
    const input = [shared, shared, shared];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    // structuredClone preserves shared references per the HTML spec
    expect(cloned[0]).toBe(cloned[1]);
    expect(cloned[1]).toBe(cloned[2]);
    expect(cloned[0]).not.toBe(shared);
    // Mutating one should affect all shared references
    cloned[0].x = 999;
    expect(cloned[1].x).toBe(999);
    expect(cloned[2].x).toBe(999);
  });

  test("objects with long string property values", () => {
    const longStr = Buffer.alloc(10000, "x").toString();
    const input = [
      { data: longStr, id: 1 },
      { data: longStr, id: 2 },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0].data.length).toBe(10000);
    expect(cloned[1].data.length).toBe(10000);
  });

  test("objects with unicode property names and values", () => {
    const input = [
      { "\u{1F600}": "smile", name: "\u{1F4A9}" },
      { "\u{1F600}": "grin", name: "\u{2764}" },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("first element is primitive, objects appear later in array", () => {
    // Ensures structure cache initializes correctly when first element is not an object
    const input = [1, 2, "hello", { a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structure cache miss: first shape has many props, second has few", () => {
    const big = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const small = { x: 1 };
    const input = [big, small, big, small];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structure cache miss: same property count but different names", () => {
    const input = [
      { a: 1, b: 2 },
      { x: 1, y: 2 },
      { a: 3, b: 4 },
      { x: 3, y: 4 },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("fallback: object with Symbol property in array", () => {
    const sym = Symbol("test");
    const obj: any = { a: 1 };
    obj[sym] = "symbol-value";
    const input = [obj];
    // structuredClone should handle this correctly (Symbols are not cloned)
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBe(1);
    expect(cloned[0][sym]).toBeUndefined();
  });

  test("fallback: object with BigInt property value in array", () => {
    const input = [{ value: 42n }];
    const cloned = structuredClone(input);
    expect(cloned[0].value).toBe(42n);
  });

  test("array of objects survives GC", () => {
    const input = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}`, flag: i % 2 === 0 }));
    const clones: any[] = [];
    for (let i = 0; i < 50; i++) {
      clones.push(structuredClone(input));
      if (i % 10 === 0) Bun.gc(true);
    }
    Bun.gc(true);
    // Verify all clones are still valid after GC
    for (const clone of clones) {
      expect(clone.length).toBe(100);
      expect(clone[0]).toEqual({ id: 0, name: "item-0", flag: true });
      expect(clone[99]).toEqual({ id: 99, name: "item-99", flag: false });
    }
  });

  test("structuredClone of array of objects does not crash under repeated GC", () => {
    const input = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      active: i % 2 === 0,
    }));
    for (let i = 0; i < 200; i++) {
      const cloned = structuredClone(input);
      expect(cloned.length).toBe(50);
      if (i % 20 === 0) Bun.gc(true);
    }
  });

  test("SerializedScriptValue can be deserialized multiple times (postMessage to two ports)", async () => {
    // Verify the serialized value is not consumed after first deserialization
    const { port1: p1a, port2: p1b } = new MessageChannel();
    const { port1: p2a, port2: p2b } = new MessageChannel();
    const input = [
      { id: 1, val: "one" },
      { id: 2, val: "two" },
    ];

    const { promise: promise1, resolve: resolve1 } = Promise.withResolvers();
    const { promise: promise2, resolve: resolve2 } = Promise.withResolvers();
    p1b.onmessage = e => resolve1(e.data);
    p2b.onmessage = e => resolve2(e.data);

    // structuredClone for each postMessage creates separate serialized values,
    // but let's verify concurrent postMessage works
    p1a.postMessage(input);
    p2a.postMessage(input);

    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1).toEqual(input);
    expect(result2).toEqual(input);

    p1a.close();
    p1b.close();
    p2a.close();
    p2b.close();
  });

  test("array of objects with all-integer property values", () => {
    const input = Array.from({ length: 20 }, (_, i) => ({ a: i, b: i * 2, c: i * 3 }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("array of objects with all-string property values", () => {
    const input = Array.from({ length: 20 }, (_, i) => ({
      first: `first-${i}`,
      last: `last-${i}`,
    }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("array of objects with all-boolean property values", () => {
    const input = Array.from({ length: 20 }, (_, i) => ({
      a: i % 2 === 0,
      b: i % 3 === 0,
    }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("fallback: array containing both simple objects and TypedArray", () => {
    const input = [{ a: 1 }, new Uint8Array([1, 2, 3])];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(new Uint8Array(cloned[1] as any)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("fallback: array containing object with function-like structure", () => {
    // Proxy objects that look object-like but aren't FinalObjectType
    const input = [
      { a: 1 },
      new (class MyObj {
        x = 42;
      })(),
    ];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(cloned[1]).toEqual({ x: 42 });
  });

  test("object property ordering is preserved after clone", () => {
    const input = [
      { z: 1, a: 2, m: 3 },
      { z: 4, a: 5, m: 6 },
    ];
    const cloned = structuredClone(input);
    expect(Object.keys(cloned[0])).toEqual(["z", "a", "m"]);
    expect(Object.keys(cloned[1])).toEqual(["z", "a", "m"]);
    expect(cloned).toEqual(input);
  });

  test("postMessage with large array of same-shape objects via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("postMessage with alternating shapes via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [{ a: 1 }, { x: "hello", y: true }, { a: 2 }, { x: "world", y: false }];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });
});
