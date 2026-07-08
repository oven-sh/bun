import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import http2 from "http2";

describe("AsyncLocalStorage", () => {
  test("throw inside of AsyncLocalStorage.run() will be passed out", () => {
    const s = new AsyncLocalStorage();
    expect(() => {
      s.run(1, () => {
        throw new Error("error");
      });
    }).toThrow("error");
  });

  // The post-run restoration assert must account for getStore() falling
  // through to defaultValue once the entry is removed (debug builds only).
  test("run() works with a defaultValue and no prior context", () => {
    const s = new AsyncLocalStorage({ defaultValue: "def" });
    expect(s.run("x", () => 42)).toBe(42);
    expect(s.getStore()).toBe("def");

    // nested inside another storage's context: entry is spliced, not cleared
    const other = new AsyncLocalStorage();
    other.run(1, () => {
      const inner = new AsyncLocalStorage({ defaultValue: "d2" });
      expect(inner.run("y", () => 7)).toBe(7);
      expect(inner.getStore()).toBe("d2");
    });

    // disable() during the callback: getStore() is undefined afterwards
    const s3 = new AsyncLocalStorage({ defaultValue: "d3" });
    expect(
      s3.run("z", () => {
        s3.disable();
        return 9;
      }),
    ).toBe(9);
    expect(s3.getStore()).toBeUndefined();
  });

  // Behaviour verified against Node v26.4.0.
  test("run() short-circuits when the store value is unchanged (Object.is)", () => {
    // enterWith inside a same-value run survives past the run
    const als1 = new AsyncLocalStorage();
    als1.enterWith("A");
    als1.run("A", () => als1.enterWith("B"));
    expect(als1.getStore()).toBe("B");

    // exit() on a fresh storage is a same-value (undefined) run
    const als2 = new AsyncLocalStorage();
    als2.exit(() => als2.enterWith("C"));
    expect(als2.getStore()).toBe("C");

    // defaultValue counts as the "current" store
    const als3 = new AsyncLocalStorage({ defaultValue: "d" });
    als3.run("d", () => als3.enterWith("X"));
    expect(als3.getStore()).toBe("X");
  });

  // Reaches the else-if(hasPrevious) re-enable branch in run()'s finally.
  test("disable() mid-run then finally restores the previous value", () => {
    const als = new AsyncLocalStorage();
    als.run("outer", () => {
      als.run("inner", () => als.disable());
      // Node v26: run's finally re-enters the previous value.
      expect(als.getStore()).toBe("outer");
    });
    expect(als.getStore()).toBeUndefined();

    // hasPrevious=true via enterWith, disable() mid-run of ANOTHER storage's callback.
    const alsA = new AsyncLocalStorage();
    const alsB = new AsyncLocalStorage();
    alsA.enterWith("prev");
    alsA.run("a", () => {
      alsB.run("b", () => alsA.disable());
      // Still inside alsA.run: finally hasn't fired yet, alsA is disabled.
      expect(alsA.getStore()).toBeUndefined();
    });
    expect(alsA.getStore()).toBe("prev");
  });
});

test("AsyncResource", () => {
  const resource = new AsyncResource("prisma-client-request");
  var called = false;
  resource.runInAsyncScope(
    () => {
      called = true;
    },
    null,
    "foo",
    "bar",
  );
  expect(called).toBe(true);
});

describe("async context passes through", () => {
  test("syncronously", () => {
    const s = new AsyncLocalStorage();
    s.run("value", () => {
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    s.run("value", () => {
      s.run("second", () => {
        expect(s.getStore()).toBe("second");
      });
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("promise.then", async () => {
    const s = new AsyncLocalStorage<string>();
    let resolve!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    let v!: string;
    s.run("value", () => {
      promise.then(() => {
        v = s.getStore()!;
      });
    });
    resolve();
    await promise;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("nested promises", async () => {
    const s = new AsyncLocalStorage<string>();
    let resolve!: () => void;
    let resolve2!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    const promise2 = new Promise<void>(r => (resolve2 = r));
    let v!: string;
    const resolved = Promise.resolve(5);
    // console.log(1);
    s.run("value", () => {
      // console.log(2);
      promise.then(() => {
        // console.log(3);
        new Promise<void>(resolve => {
          // console.log(4);
          setTimeout(() => {
            // console.log(5);
            resolve();
          }, 1);
        }).then(() => {
          // console.log(6);
          resolved.then(() => {
            // console.log(7);
            v = s.getStore()!;
            resolve2();
          });
        });
      });
    });
    resolve();
    await promise2;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("await 1", async () => {
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      await 1;
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("await an actual promise", async () => {
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      await Promise.resolve(1);
      expect(s.getStore()).toBe("value");
      await Bun.sleep(2);
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("setTimeout", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    s.run("value", () => {
      expect(s.getStore()).toBe("value");
      setTimeout(() => {
        resolve(s.getStore()!);
      }, 2);
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("setInterval", async () => {
    let resolve: (x: string[]) => void;
    const promise = new Promise<string[]>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      const array: string[] = [];
      const interval = setInterval(() => {
        array.push(s.getStore()!);
        if (array.length === 3) {
          clearInterval(interval);
          resolve(array);
        }
      }, 5);
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toEqual(["value", "value", "value"]);
  });
  test("setImmediate", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      setImmediate(() => {
        resolve(s.getStore()!);
      });
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("process.nextTick", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      process.nextTick(() => {
        resolve(s.getStore()!);
      });
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("queueMicrotask", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      queueMicrotask(() => {
        resolve(s.getStore()!);
      });
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("promise catch", async () => {
    const s = new AsyncLocalStorage<string>();
    let reject!: () => void;
    let promise = new Promise<void>((_, r) => (reject = r));
    let v!: string;
    s.run("value", () => {
      promise = promise.catch(() => {
        v = s.getStore()!;
      });
    });
    reject();
    await promise;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("promise finally", async () => {
    const s = new AsyncLocalStorage<string>();
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    let v!: string;
    s.run("value", () => {
      promise = promise.finally(() => {
        v = s.getStore()!;
      });
    });
    resolve();
    await promise;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("fetch", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      const response = await fetch(server.url) //
        .then(r => {
          expect(s.getStore()).toBe("value");
          return true;
        });
      expect(s.getStore()).toBe("value");
      expect(response).toBe(true);
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("Bun.spawn() onExit", async () => {
    const s = new AsyncLocalStorage<string>();
    let value: string | undefined;
    let resolve!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");

      const x = Bun.spawn({
        cmd: [bunExe(), "help"],
        env: bunEnv,
        onExit(subprocess, exitCode, signalCode, error) {
          value = s.getStore()!;
          resolve();
        },
      });

      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    await promise;
    expect(value).toBe("value");
  });
  test("Bun.serve", async () => {
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");

      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          return new Response(s.getStore()!);
        },
      });

      const response = await fetch("http://" + server.hostname + ":" + server.port);
      expect(await response.text()).toBe("value");

      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .start", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    s.run("value", async () => {
      stream = new ReadableStream({
        start(controller) {
          controller.enqueue(s.getStore()!);
          controller.close();
        },
      });
    });
    const reader = stream.getReader();
    const result = await reader.read();
    expect(result.value).toBe("value");
    const result2 = await reader.read();
    expect(result2.done).toBe(true);
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .pull", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    s.run("value", async () => {
      stream = new ReadableStream(
        {
          start(controller) {
            controller.enqueue(new Uint8Array(500));
          },
          pull(controller) {
            controller.enqueue(s.getStore()!);
            controller.close();
          },
        },
        {
          highWaterMark: 1,
          size() {
            return 500;
          },
        },
      );
    });
    const reader = stream.getReader();
    const result = await reader.read();
    const result2 = await reader.read();
    expect(result2.value).toBe("value");
    const result3 = await reader.read();
    expect(result3.done).toBe(true);
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .pull 2", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let n = 0;
    s.run("value", async () => {
      stream = new ReadableStream(
        {
          start(controller) {
            controller.enqueue(new Uint8Array(500));
          },
          async pull(controller) {
            controller.enqueue(s.getStore()!);
            n++;
            if (n < 5) {
              await new Promise(r => setTimeout(r, 1));
            } else {
              controller.close();
            }
          },
        },
        {
          highWaterMark: 1,
          size() {
            return 500;
          },
        },
      );
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    const result = await reader.read();
    const result2 = await reader.read();
    expect(result2.value).toBe("value");
    const result3 = await reader.read();
    expect(result3.value).toBe("value");
    const result4 = await reader.read();
    expect(result4.value).toBe("value");
    const result5 = await reader.read();
    expect(result5.value).toBe("value");
    const result6 = await reader.read();
    expect(result6.value).toBe("value");
    const result7 = await reader.read();
    expect(result7.done).toBe(true);
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .cancel", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let value: string | undefined;
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    s.run("value", async () => {
      stream = new ReadableStream({
        start(controller) {},
        cancel(reason) {
          value = s.getStore();
          resolve();
        },
      });
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    reader.cancel();
    await promise;
    expect(value).toBe("value");
  });
  test("readable stream direct .pull", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let value: string | undefined;
    let value2: string | undefined;
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    s.run("value", async () => {
      stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          value = s.getStore();
          controller.write("hello");
          controller.close();
          resolve();
        },
        cancel(reason) {},
      });
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    await reader.read();
    await promise;
    expect(value).toBe("value");
  });
  // blocked by a bug with .cancel
  test.todo("readable stream direct .cancel", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let value: string | undefined;
    let value2: string | undefined;
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    s.run("value", async () => {
      stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          value = s.getStore();
          controller.write("hello");
        },
        cancel(reason) {
          console.log("1");
          value2 = s.getStore();
          resolve();
        },
      });
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    await stream.cancel();
    await promise;
    expect(value).toBe("value");
    expect(value2).toBe("value");
  });
  test("Websocket Server", async () => {
    const s = new AsyncLocalStorage<string>();
    let values_server: string[] = [];
    const { promise, resolve } = Promise.withResolvers();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");

      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          if (server.upgrade(request)) return null as any;
          return new Response(s.getStore()!);
        },
        websocket: {
          open(ws) {
            values_server.push("open:" + s.getStore());
          },
          message(ws, message) {
            values_server.push("message:" + s.getStore());
            ws.close();
          },
          close(ws, code, message) {
            values_server.push("close:" + s.getStore());
          },
        },
      });

      const ws = new WebSocket("ws://" + server.hostname + ":" + server.port);
      ws.addEventListener("open", () => {
        ws.send("hello");
      });
      ws.addEventListener("close", () => {
        resolve();
      });
      await promise;
    });
    expect(s.getStore()).toBe(undefined);
    expect(values_server).toEqual(["open:value", "message:value", "close:value"]);
  });
  test.todo("WebSocket client", async () => {
    const s = new AsyncLocalStorage<string>();
    let values_client: string[] = [];
    const { promise, resolve } = Promise.withResolvers();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");

      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          if (server.upgrade(request)) return null as any;
          return new Response(s.getStore()!);
        },
        websocket: {
          open(ws) {},
          message(ws, message) {
            ws.close();
          },
          close(ws, code, message) {},
        },
      });

      const ws = new WebSocket("ws://" + server.hostname + ":" + server.port);
      ws.addEventListener("open", () => {
        ws.send("hello");
        values_client.push("open:" + s.getStore());
      });
      ws.addEventListener("close", () => {
        resolve();
        values_client.push("close:" + s.getStore());
      });
    });
    expect(s.getStore()).toBe(undefined);
    await promise;
    expect(values_client).toEqual(["open:value", "close:value"]);
  });
  test("node:fs callback", async () => {
    const fs = require("fs");
    const s = new AsyncLocalStorage<string>();
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      fs.readFile(import.meta.path, () => {
        resolve(s.getStore()!);
      });
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("node:fs/promises", async () => {
    const fs = require("fs").promises;
    const s = new AsyncLocalStorage<string>();
    let v!: string;
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      await fs.readFile(import.meta.path).then(() => {
        v = s.getStore()!;
      });
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    expect(v).toBe("value");
  });
  test("http2 client stream: native events see request-time context; user emit sees caller context", async () => {
    const s = new AsyncLocalStorage<string>();
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const client = http2.connect(`http://127.0.0.1:${port}`);
    try {
      const req = s.run("REQUEST", () => client.request({ ":path": "/" }));

      // Native-driven events observe the context captured at request() time.
      const responseStore = new Promise(r => req.on("response", () => r(s.getStore())));
      const dataStore = new Promise(r => req.on("data", () => r(s.getStore())));
      const endStore = new Promise(r => req.on("end", () => r(s.getStore())));
      const closeStore = new Promise(r => req.on("close", () => r(s.getStore())));
      req.end();
      expect(await responseStore).toBe("REQUEST");
      expect(await dataStore).toBe("REQUEST");
      expect(await endStore).toBe("REQUEST");
      expect(await closeStore).toBe("REQUEST");

      // User-initiated emit() observes the CALLER's context (Node semantics —
      // only native→JS callbacks re-enter the resource scope; Bun swaps the
      // frame at the #Handlers seam, not by overriding emit()).
      let customStore;
      req.on("custom", () => {
        customStore = s.getStore();
      });
      s.run("USER", () => req.emit("custom"));
      expect(customStore).toBe("USER");
    } finally {
      client.close();
      await new Promise(r => server.close(r));
    }
  });
  test("Bun.build plugin", async () => {
    const s = new AsyncLocalStorage<string>();
    let a = undefined;
    await s.run("value", async () => {
      return Bun.build({
        entrypoints: [import.meta.path],
        target: "bun",
        plugins: [
          {
            name: "test",
            setup(build) {
              a = s.getStore();
            },
          },
        ],
      });
    });
    expect(a).toBe("value");
  });
});
