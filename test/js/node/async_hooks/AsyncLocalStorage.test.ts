import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
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

    // disable() during the callback: run() finally re-enables (Node's is
    // unconditionally enterWith(prior)), so getStore() falls through to
    // defaultValue. Verified against Node v26.4.0 (both --async-context-frame
    // and --no-async-context-frame).
    const s3 = new AsyncLocalStorage({ defaultValue: "d3" });
    expect(
      s3.run("z", () => {
        s3.disable();
        return 9;
      }),
    ).toBe(9);
    expect(s3.getStore()).toBe("d3");

    // Bare disable() without run(): getStore() returns defaultValue, not
    // undefined (Node v26 both impls).
    const s4 = new AsyncLocalStorage({ defaultValue: "d4" });
    s4.enterWith("v");
    s4.disable();
    expect(s4.getStore()).toBe("d4");
  });

  // NaN is a legal store value in Node; === cannot compare it.
  // Verified against Node v26.3.0.
  test("NaN is usable as a store value and as defaultValue", () => {
    const s = new AsyncLocalStorage();
    expect(s.run(NaN, () => s.getStore())).toBeNaN();

    const withDefault = new AsyncLocalStorage({ defaultValue: NaN });
    expect(withDefault.run("x", () => 42)).toBe(42);
    expect(withDefault.getStore()).toBeNaN();

    const other = new AsyncLocalStorage();
    const s2 = new AsyncLocalStorage();
    try {
      other.enterWith("keep");
      s2.enterWith(NaN);
      expect(s2.getStore()).toBeNaN();
      expect(other.getStore()).toBe("keep");
    } finally {
      // enterWith() is not scoped: splice both back out so later tests still
      // start from an empty context.
      s2.disable();
      other.disable();
    }
  });

  // Node compares stores with the primordial ObjectIs, which userland cannot
  // reach. Subprocess: patches a global. Verified against Node v26.3.0.
  test("run() is unaffected by a userland Object.is patch", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Object.is = () => true;
         const { AsyncLocalStorage } = require("async_hooks");
         const s = new AsyncLocalStorage();
         console.log(s.run("v", () => s.getStore()));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "v", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // run() entered on a disabled storage must still restore on the way out:
  // node's finally is an unconditional enterWith(prior), so the store must not
  // survive past run(). Verified against Node v26.3.0.
  test("run() on a disabled storage does not leak the store past the callback", () => {
    const a = new AsyncLocalStorage();
    a.disable();
    expect(a.run("Y", () => a.getStore())).toBe("Y");
    expect(a.getStore()).toBeUndefined();

    const b = new AsyncLocalStorage({ defaultValue: "D" });
    b.disable();
    expect(b.run("Y", () => b.getStore())).toBe("Y");
    expect(b.getStore()).toBe("D");

    // ...including when the callback disables it again.
    const c = new AsyncLocalStorage({ defaultValue: "D" });
    c.disable();
    c.run("Y", () => c.disable());
    expect(c.getStore()).toBe("D");
  });

  // A snapshot-restored frame can hold a value for a disabled storage, which
  // getStore() masks with defaultValue — run() must not short-circuit on that
  // comparison and leave the masked value visible. Verified against Node v26.3.0.
  test("run() inside a snapshot does not expose a disabled storage's frame value", () => {
    const als = new AsyncLocalStorage<string>();
    let snap!: <T>(fn: () => T) => T;
    als.run("X", () => {
      snap = AsyncLocalStorage.snapshot();
    });
    als.disable();
    expect(snap(() => als.exit(() => als.getStore()))).toBeUndefined();

    const withDefault = new AsyncLocalStorage<string>({ defaultValue: "D" });
    let snap2!: <T>(fn: () => T) => T;
    withDefault.run("Y", () => {
      snap2 = AsyncLocalStorage.snapshot();
    });
    withDefault.disable();
    expect(snap2(() => withDefault.run(undefined, () => withDefault.getStore()))).toBeUndefined();
  });

  // run() on a disabled storage takes the full path and re-enables it.
  // Verified against Node.
  test("run(undefined)/exit() on a disabled storage re-enables it", () => {
    const als = new AsyncLocalStorage();
    als.disable();
    als.exit(() => {});
    als.run("Y", () => {});
    expect(als.getStore()).toBeUndefined();
  });

  // Behaviour verified against Node v26.4.0.
  test("run() short-circuits when the store value is unchanged (Object.is)", () => {
    const als1 = new AsyncLocalStorage();
    const als2 = new AsyncLocalStorage();
    const als3 = new AsyncLocalStorage({ defaultValue: "d" });
    try {
      // enterWith inside a same-value run survives past the run
      als1.enterWith("A");
      als1.run("A", () => als1.enterWith("B"));
      expect(als1.getStore()).toBe("B");

      // exit() on a fresh storage is a same-value (undefined) run
      als2.exit(() => als2.enterWith("C"));
      expect(als2.getStore()).toBe("C");

      // defaultValue counts as the "current" store
      als3.run("d", () => als3.enterWith("X"));
      expect(als3.getStore()).toBe("X");
    } finally {
      // enterWith() is not scoped: splice the entries back out so later
      // tests still start from an empty context.
      als1.disable();
      als2.disable();
      als3.disable();
    }
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
    try {
      alsA.enterWith("prev");
      alsA.run("a", () => {
        alsB.run("b", () => alsA.disable());
        // Still inside alsA.run: finally hasn't fired yet, alsA is disabled.
        expect(alsA.getStore()).toBeUndefined();
      });
      expect(alsA.getStore()).toBe("prev");
    } finally {
      // alsB is spliced out by its own run(); enterWith('prev') is not scoped.
      alsA.disable();
    }
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

      // Session-level 'close' must observe the SESSION's construction-time
      // context (undefined here), not the last stream's — Node fires it in
      // the Http2Session AsyncWrap scope, not any Http2Stream's. The
      // withStreamFrame-wrapped streamEnd calls self.destroy() while the
      // stream's frame is installed, so destroy() must run its own emits in
      // the session frame.
      const sessionCloseStore = new Promise(r => client.on("close", () => r(s.getStore())));
      client.close();
      expect(await sessionCloseStore).toBeUndefined();
    } finally {
      if (!client.destroyed) client.destroy();
      await new Promise(r => server.close(r));
    }
  });
  // An error in the window between onSocket() and onSocketNT() must still see
  // the request's context: the socket listeners are frame-wrapped, and an
  // unset frame would clear it. Verified against Node v26.3.0.
  test("http: a socket error before onSocketNT keeps the request's context", async () => {
    const http = require("http");
    const net = require("net");
    const s = new AsyncLocalStorage<string>();
    const { promise, resolve, reject } = Promise.withResolvers<string>();

    const agent = new http.Agent();
    let injected: import("net").Socket | undefined;
    agent.createConnection = function () {
      const sock = new net.Socket();
      injected = sock;
      let armed = false;
      const on = sock.on.bind(sock);
      sock.on = function (ev, fn) {
        const r = on(ev, fn);
        // Arm once, during onSocket()'s own socket.on("error") registration, so
        // it fires before onSocket()'s process.nextTick(onSocketNT, ...).
        if (ev === "error" && !armed) {
          armed = true;
          process.nextTick(() => sock.emit("error", new Error("boom")));
        }
        return r;
      };
      return sock;
    };

    try {
      s.run("X", () => {
        const req = http.request({ host: "127.0.0.1", port: 1, agent });
        // Assert on the injected error specifically: a connect-refusal error
        // reaching here instead means the pre-onSocketNT window was missed and
        // the test would otherwise pass without exercising the fix.
        req.on("error", err => resolve(`${(err as Error).message}|${s.getStore()}`));
        req.on("response", () => reject(new Error("unexpected response")));
        req.end();
      });

      expect(await promise).toBe("boom|X");
    } finally {
      injected?.destroy();
      agent.destroy();
    }
  });

  test("http agent reuse: req 'error'/'close' see the reused request's context", async () => {
    const http = require("http");
    const net = require("net");
    const s = new AsyncLocalStorage<string>();
    let dataHits = 0;
    // Keep-alive reuses ONE connection: first request served, second RST'd.
    const server = net.createServer(sock => {
      sock.on("data", () => {
        dataHits++;
        if (dataHits === 1) sock.write("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\nok");
        else sock.resetAndDestroy();
      });
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const { errorStore, closeStore } = await new Promise<{ errorStore: unknown; closeStore: unknown }>(
        (resolve, reject) => {
          s.run("first", () => {
            const r1 = http.request({ host: "127.0.0.1", port, agent }, res => {
              res.resume();
              res.on("end", () => {
                // setImmediate() lets the agent register the freed socket.
                setImmediate(() => {
                  s.run("second", () => {
                    const r2 = http.request({ host: "127.0.0.1", port, agent });
                    let errorStore: unknown, closeStore: unknown;
                    r2.on("error", () => {
                      errorStore = s.getStore();
                    });
                    r2.on("close", () => {
                      closeStore = s.getStore();
                      resolve({ errorStore, closeStore });
                    });
                    r2.end();
                  });
                });
              });
            });
            r1.on("error", reject);
            r1.end();
          });
        },
      );
      expect(errorStore).toBe("second");
      expect(closeStore).toBe("second");
    } finally {
      agent.destroy();
      await new Promise(r => server.close(r));
    }
  });
  test("http.request clears its captured async-context frame on 'close'", async () => {
    const http = require("http");
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const agent = new http.Agent({ keepAlive: true });
    const s = new AsyncLocalStorage<object>();
    let req: any;
    try {
      await s.run(
        { marker: true },
        () =>
          new Promise<void>((resolve, reject) => {
            req = http.request({ host: "127.0.0.1", port, agent }, res => {
              res.resume();
            });
            req.on("error", reject);
            req.on("close", resolve);
            req.end();
          }),
      );
      // req is retained past 'close'; closeRequest() must have cleared the
      // frame slot so the store is not pinned by the retained request. This
      // is Bun's counterpart to Node's parser.initialize resource leak (Bun's
      // parser binding ignores the resource argument, so the vendored
      // test-async-local-storage-http-parser-leak.js is a compat-only no-op
      // — this is the coverage that fails if the closeRequest cleanup drops).
      const kClientAsyncContext = Object.getOwnPropertySymbols(req).find(
        sym => sym.description === "kClientAsyncContext",
      );
      expect(kClientAsyncContext).toBeDefined();
      expect(req[kClientAsyncContext!]).toBeUndefined();
    } finally {
      agent.destroy();
      await new Promise(r => server.close(r));
    }
  });
  // http2 counterpart of the http1 cleanup above: a stream/session retained
  // past its terminal event must not pin the store.
  test("http2 clears its captured async-context frame on stream and session close", async () => {
    const server = http2.createServer((_req, res) => res.end("ok"));
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const s = new AsyncLocalStorage<object>();
    let stream: any, client: any;
    let closed!: Promise<void>;
    try {
      await s.run(
        { marker: true },
        () =>
          new Promise<void>((resolve, reject) => {
            client = http2.connect(`http://127.0.0.1:${port}`);
            client.on("error", reject);
            // Registered before the await: the session can close on its own and
            // this must not miss the event.
            closed = new Promise<void>(r => client.on("close", () => r()));
            stream = client.request({ ":path": "/" });
            stream.on("error", reject);
            stream.resume();
            stream.on("close", () => resolve());
            stream.end();
          }),
      );
      const frameSym = Object.getOwnPropertySymbols(stream).find(
        sym => sym.description === "::bunhttp2asynccontextframe::",
      );
      expect(frameSym).toBeDefined();
      expect(stream[frameSym!]).toBeUndefined();

      client.close();
      await closed;
      expect(client[frameSym!]).toBeUndefined();
    } finally {
      if (client && !client.destroyed) client.destroy();
      await new Promise(r => server.close(r));
    }
  });

  // The session frame is read-and-cleared before the emit, so a throwing
  // 'close' listener cannot leave a retained session pinning the store.
  // Subprocess: the listener throws, which the test runner would otherwise
  // claim as its own failure.
  test("http2 clears the session frame even if a 'close' listener throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http2 = require("http2");
         const als = new AsyncLocalStorage();
         const server = http2.createServer((_q, r) => r.end("ok"));
         server.listen(0, () => {
           let client;
           als.run({ marker: true }, () => {
             client = http2.connect("http://127.0.0.1:" + server.address().port);
             const s = client.request({ ":path": "/" });
             s.resume();
             s.on("close", () => client.close());
             s.end();
           });
           client.on("close", () => { throw new Error("listener boom"); });
           client.on("error", () => {});
           // The throw IS the condition: it can only come from the 'close'
           // emit, which runs strictly after the read-and-clear.
           process.on("uncaughtException", err => {
             if (err.message !== "listener boom") throw err;
             const sym = Object.getOwnPropertySymbols(client)
               .find(x => x.description === "::bunhttp2asynccontextframe::");
             console.log(sym === undefined ? "SYMBOL-MISSING" : client[sym] === undefined ? "CLEARED" : "PINNED");
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // destroy(err) with no 'error' listener throws out of the emit, which must
  // not skip the frame clear (the 'close' tick after it never runs).
  test("http2 clears the session frame when destroy(err) throws past the emit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http2 = require("http2");
         const als = new AsyncLocalStorage();
         const server = http2.createServer((_q, r) => r.end("ok"));
         server.listen(0, () => {
           let client;
           als.run({ marker: true }, () => {
             client = http2.connect("http://127.0.0.1:" + server.address().port);
           });
           client.on("connect", () => {
             try { client.destroy(new Error("boom")); } catch {}
             const sym = Object.getOwnPropertySymbols(client)
               .find(x => x.description === "::bunhttp2asynccontextframe::");
             console.log(sym === undefined ? "SYMBOL-MISSING" : client[sym] === undefined ? "CLEARED" : "PINNED");
             // Drain rather than process.exit(), like the siblings.
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // _destroy emits 'aborted' (and can reach user code via end()/push(null))
  // before it finishes; the clear must not sit downstream of that. The throw is
  // swallowed into the stream's 'error', so this leak is otherwise silent.
  test("http2 clears the stream frame even if an 'aborted' listener throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http2 = require("http2");
         const als = new AsyncLocalStorage();
         const server = http2.createServer((_q, r) => { r.write("a"); });
         server.listen(0, () => {
           const client = http2.connect("http://127.0.0.1:" + server.address().port);
           let st;
           // endStream:false keeps the writable side open: like Node, destroy()
           // only emits 'aborted' for a stream whose writable side has not ended
           // (a plain GET ends it up front, so 'aborted' would never fire).
           als.run({ marker: true }, () => {
             st = client.request({ ":path": "/" }, { endStream: false });
             st.resume();
           });
           st.on("aborted", () => { throw new Error("aborted boom"); });
           st.on("response", () => st.destroy());
           // The throw is swallowed into the stream's 'error' — that event IS
           // the condition, and it fires after _destroy has unwound. ('close'
           // never arrives: the throw aborts the destroy.)
           st.on("error", err => {
             if (err.message !== "aborted boom") throw err;
             const sym = Object.getOwnPropertySymbols(st)
               .find(x => x.description === "::bunhttp2asynccontextframe::");
             console.log(sym === undefined ? "SYMBOL-MISSING" : st[sym] === undefined ? "CLEARED" : "PINNED");
             // Tear the session down and let the loop drain: exiting with the
             // session still open leaks it, which aborts under ASAN.
             client.destroy();
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // The upgrade/connect branch emits before closeRequest(), which carries the
  // clear; a throwing handler must not leave the request pinning the store.
  test("http clears the request frame even if an 'upgrade' handler throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http = require("http");
         const net = require("net");
         const als = new AsyncLocalStorage();
         const server = net.createServer(sock => {
           sock.once("data", () => sock.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: x\\r\\nConnection: Upgrade\\r\\n\\r\\n"));
         });
         server.listen(0, "127.0.0.1", () => {
           let req;
           als.run({ marker: true }, () => {
             req = http.request({ host: "127.0.0.1", port: server.address().port, headers: { Connection: "Upgrade", Upgrade: "x" } });
             req.end();
           });
           req.on("error", () => {});
           let upgraded;
           req.on("upgrade", (_res, socket) => { upgraded = socket; throw new Error("upgrade boom"); });
           process.on("uncaughtException", err => {
             if (err.message !== "upgrade boom") throw err;
             const sym = Object.getOwnPropertySymbols(req)
               .find(x => x.description === "kClientAsyncContext");
             console.log(sym === undefined ? "SYMBOL-MISSING" : req[sym] === undefined ? "CLEARED" : "PINNED");
             // Close the upgraded socket too: exiting with it open leaks it,
             // which aborts under ASAN.
             upgraded?.destroy();
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
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

describe("unhandledRejection async context", () => {
  // Bun replays the context the promise was *rejected* in. Node >= 24 (and Node 22
  // with --experimental-async-context-frame) does the same; Node 22's default
  // async_hooks-based AsyncLocalStorage replays the *creation* context instead.
  // The dual-runtime fixture in async-context/ only covers cases where the two
  // agree, so this one is bun-only.
  test("the rejection-time context wins over the creation-time context", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        const seen = [];
        process.on("unhandledRejection", reason => {
          seen.push(reason.message + "=" + JSON.stringify(als.getStore() ?? null));
          if (seen.length === 2) console.log(seen.join(" "));
        });

        let rejectCreatedInA;
        als.run("A", () => { new Promise((_, reject) => { rejectCreatedInA = reject; }); });
        als.run("B", () => rejectCreatedInA(new Error("created-in-A")));

        let rejectCreatedInC;
        als.run("C", () => { new Promise((_, reject) => { rejectCreatedInC = reject; }); });
        rejectCreatedInC(new Error("created-in-C"));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`created-in-A="B" created-in-C=null\n`);
    expect(exitCode).toBe(0);
  });

  // Rejections raised inside a context are stored wrapped in an AsyncContextFrame,
  // so both places that match a promise against the pending list have to unwrap.
  test("a promise handled in the same tick emits neither unhandledRejection nor rejectionHandled", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        const events = [];
        process.on("unhandledRejection", reason => events.push("unhandled:" + reason.message + ":" + als.getStore()));
        process.on("rejectionHandled", () => events.push("rejectionHandled"));

        let late;
        als.run("ctx", () => {
          Promise.reject(new Error("same-tick")).catch(() => {});
          late = Promise.reject(new Error("late"));
        });
        await new Promise(resolve => setImmediate(resolve));
        late.catch(() => {});
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        console.log(events.join(","));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("unhandled:late:ctx,rejectionHandled\n");
    expect(exitCode).toBe(0);
  });

  // expect(fn).toThrow() drains pending rejections synchronously, so the drain can
  // run while a context is installed. A promise rejected without one must still
  // replay "no context" rather than inherit whatever the caller had.
  test("a contextless rejection drained from inside a context replays an undefined store", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { expect } = require("bun:test");
        const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        process.on("unhandledRejection", () => {
          console.log("store:", JSON.stringify(als.getStore() ?? null));
        });

        Promise.reject(new Error("no-context"));
        als.run({ id: "X" }, () => {
          expect(() => { throw new Error("boom"); }).toThrow("boom");
        });`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("store: null\n");
    expect(exitCode).toBe(0);
  });

  // --unhandled-rejections=strict routes the rejection into uncaughtException. Node
  // keeps the promise's context installed across the whole per-mode dispatch
  // (lib/internal/process/promises.js), so the uncaughtException handler sees it too —
  // but it drains microtasks outside that window, so a continuation registered with no
  // context must not pick the store up.
  test.each([
    ["bun", bunExe()],
    ["node", nodeExe()],
  ])("--unhandled-rejections=strict keeps the context for uncaughtException only (%s)", async (_name, exe) => {
    await using proc = Bun.spawn({
      cmd: [
        exe,
        "--unhandled-rejections=strict",
        "-e",
        `const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();

        let resumeDrainedMicrotask;
        const pending = new Promise(resolve => { resumeDrainedMicrotask = resolve; });
        pending.then(() => {
          console.log("drained microtask store:", als.getStore());
          process.exit(0);
        });

        process.on("uncaughtException", () => {
          console.log("uncaughtException store:", als.getStore());
          resumeDrainedMicrotask();
        });
        als.run(7, () => { Promise.reject(new Error("strict")); });`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("uncaughtException store: 7\ndrained microtask store: undefined\n");
    expect(exitCode).toBe(0);
  });

  // An unhandledRejection listener that throws reaches uncaughtException, but Node's
  // processPromiseRejections restores the previous frame in a finally before that
  // throw propagates. The strict-mode direct dispatch above is the only path where
  // uncaughtException sees the promise's context.
  test.each([
    ["bun", bunExe()],
    ["node", nodeExe()],
  ])("a throwing unhandledRejection listener reaches uncaughtException without the promise's context (%s)", async (_name, exe) => {
    await using proc = Bun.spawn({
      cmd: [
        exe,
        "-e",
        `const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        process.on("unhandledRejection", () => {
          console.log("unhandledRejection store:", JSON.stringify(als.getStore() ?? null));
          throw new Error("from-listener");
        });
        process.on("uncaughtException", () => {
          console.log("uncaughtException store:", JSON.stringify(als.getStore() ?? null));
          process.exit(0);
        });
        als.run(7, () => Promise.reject(new Error("e")));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("unhandledRejection store: 7\nuncaughtException store: null\n");
    expect(exitCode).toBe(0);
  });

  // `bun test` (isBunTest) doesn't dispatch the process event at all; the test
  // runner's handler receives the rejection instead, and that path must not let
  // the promise's context reach a later unwrapped test callback.
  test("under `bun test`, an in-context rejection doesn't leak the store into the next test callback", async () => {
    using dir = tempDir("als-unhandled-rejection-buntest", {
      "probe.test.ts": `
        import { test } from "bun:test";
        import { AsyncLocalStorage } from "node:async_hooks";
        const als = new AsyncLocalStorage();

        test("rejects inside a store", () => {
          als.run({ id: "leaky" }, () => {
            Promise.reject(new Error("in-store"));
          });
        });

        test("next callback observes no leaked store", () => {
          console.log("PROBE store:", JSON.stringify(als.getStore() ?? null));
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "probe.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("PROBE store: null");
    expect(stderr).toContain("(pass) next callback observes no leaked store");
    expect(stderr).toContain("(fail) rejects inside a store");
    expect(exitCode).not.toBe(0);
  });
});
