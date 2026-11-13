import { bunEnv, bunExe } from "harness";

test("simple usage", done => {
  const channel = new MessageChannel();
  const port1 = channel.port1;
  const port2 = channel.port2;

  port2.onmessage = e => {
    expect(e.data).toEqual("hello");
    done();
  };

  port1.postMessage("hello");
});

test("transfer message port", done => {
  const channel = new MessageChannel();
  const anotherChannel = new MessageChannel();
  const port1 = channel.port1;
  const port2 = channel.port2;

  port2.onmessage = e => {
    expect(e.data).toEqual("hello");
    expect(e.ports).toHaveLength(1);
    expect(e.ports[0]).toBeInstanceOf(MessagePort);
    done();
  };

  port1.postMessage("hello", [anotherChannel.port2]);
});

test("transfer array buffer", done => {
  const channel = new MessageChannel();
  const port1 = channel.port1;
  const port2 = channel.port2;

  port2.onmessage = e => {
    expect(e.data).toBeInstanceOf(ArrayBuffer);
    expect(e.data.byteLength).toEqual(8);
    done();
  };

  const buffer = new ArrayBuffer(8);

  port1.postMessage(buffer, [buffer]);
});

test("non-transferable", () => {
  const channel = new MessageChannel();
  channel.port2.onmessage = () => {
    expect().fail("should not be reached");
  };
  expect(() => {
    channel.port1.postMessage("hello", [channel.port1]);
  }).toThrow();
  // node: posting the source port's own entangled peer targets the message at
  // itself, which warns and loses the channel rather than throwing.
  expect(() => {
    channel.port1.postMessage("hello", [channel.port2]);
  }).not.toThrow();
});

test("transfer message ports and post messages", done => {
  const c1 = new MessageChannel();
  const c2 = new MessageChannel();

  c1.port1.onmessage = e => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 1 port 2");
    port.onmessage = e => {
      expect(e.data).toEqual("hello from channel 1 port 2");
      done();
    };
    port.postMessage("hello from channel 1 port 1", [c1.port1]);
  };

  c1.port2.onmessage = e => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 2 port 1");
    port.postMessage("hello from channel 1 port 2");
  };

  c2.port1.onmessage = e => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 1 port 1");
    port.postMessage("hello from channel 2 port 1", [c2.port1]);
  };

  c2.port2.onmessage = () => {
    expect().fail("onmessage defined on c1.port1 should be called instead");
  };

  c1.port2.postMessage("hello from channel 1 port 2", [c2.port2]);
});

test("message channel created on main thread", done => {
  const worker = new Worker(new URL("receive-port-worker.js", import.meta.url).href);
  worker.onerror = e => {
    expect().fail();
    done();
  };
  const channel = new MessageChannel();
  channel.port1.onmessage = e => {
    if (e.data === "done!") return done();
    expect(e.data).toEqual("received port!");
    channel.port1.postMessage("more message!");
  };
  worker.postMessage(channel.port2, { transfer: [channel.port2] });
});

test("message channel created on other thread", done => {
  const worker = new Worker(new URL("create-port-worker.js", import.meta.url).href);
  worker.onerror = () => {
    expect().fail();
    done();
  };
  worker.onmessage = e => {
    expect(e.data).toBeInstanceOf(MessagePort);
    const port = e.data;
    port.onmessage = (e: MessageEvent) => {
      expect(e.data).toEqual("done!");
      done();
    };
    port.postMessage("hello from main thread");
  };
});

test("many message channels", done => {
  const channel = new MessageChannel();
  const channel2 = new MessageChannel();
  const channel3 = new MessageChannel();
  const channel4 = new MessageChannel();

  channel.port1.postMessage("noport");
  channel.port1.postMessage("zero ports", []);
  channel.port1.postMessage("two ports", [channel2.port1, channel2.port2]);

  // Now test failure cases
  expect(() => {
    channel.port1.postMessage("same port", [channel.port1]);
  }).toThrow();
  // node: posting the entangled peer warns and loses the channel, not a throw.
  // Use a dedicated channel: the post closes its source port, which would break
  // the "done" delivery on the shared channel below.
  {
    const peerChannel = new MessageChannel();
    expect(() => {
      peerChannel.port1.postMessage("entangled port", [peerChannel.port2]);
    }).not.toThrow();
  }
  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("null port", [channel3.port1, null, channel3.port2]);
  }).toThrow();
  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("notAPort", [channel3.port1, {}, channel3.port2]);
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("duplicate port", [channel3.port1, channel3.port1]);
  }).toThrow();

  // Should be OK to send channel3.port1 (should not have been disentangled by the previous failed calls).
  expect(() => {
    channel.port1.postMessage("entangled ports", [channel3.port1, channel3.port2]);
  }).not.toThrow();

  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("notAnArray", "foo");
  }).toThrow();
  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("notASequence", [{ length: 3 }]);
  }).toThrow();

  // Should not crash (we should figure out that the array contains undefined entries).
  const largePortArray: MessagePort[] = [];
  largePortArray[1234567890] = channel4.port1;
  expect(() => {
    channel.port1.postMessage("largeSequence", largePortArray);
  }).toThrow();

  channel.port1.postMessage("done");

  function testTransfers(done: any) {
    const channel0 = new MessageChannel();

    const c1 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-port", port: c1.port1 }, [c1.port1]);
    const c2 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-port-twice", port0: c2.port1, port1: c2.port1 }, [c2.port1]);
    const c3 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-two-ports", port0: c3.port1, port1: c3.port2 }, [c3.port1, c3.port2]);
    const c4 = new MessageChannel();

    // Sending host objects should throw
    expect(() => {
      channel0.port1.postMessage({ id: "host-object", hostObject: c3, port: c4.port1 }, [c4.port1]);
    }).toThrow();

    // Sending Function object should throw
    expect(() => {
      const f1 = function () {};
      channel0.port1.postMessage({ id: "function-object", function: f1, port: c4.port1 }, [c4.port1]);
    }).toThrow();

    // Sending Error object should not throw
    expect(() => {
      const err = new Error();
      channel0.port1.postMessage({ id: "error-object", error: err, port: c4.port1 }, [c4.port1]);
    }).not.toThrow();

    c4.port1.postMessage("Should succeed");
    channel0.port1.postMessage({ id: "done" });

    channel0.port2.onmessage = function (event) {
      if (event.data.id == "send-port") {
        expect(event.ports.length).toBeGreaterThan(0);
        expect(event.ports[0]).toBe(event.data.port);
      } else if (event.data.id == "error-object") {
        expect(event.data.error).toBeInstanceOf(Error);
      } else if (event.data.id == "send-port-twice") {
        expect(event.ports).toBeDefined();
        expect(event.ports.length).toBe(1);
        expect(event.ports[0]).toBe(event.data.port0);
        expect(event.ports[0]).toBe(event.data.port1);
      } else if (event.data.id == "send-two-ports") {
        expect(event.ports).toBeDefined();
        expect(event.ports.length).toBe(2);
        expect(event.ports[0]).toBe(event.data.port0);
        expect(event.ports[1]).toBe(event.data.port1);
      } else if (event.data.id == "done") {
        done();
      } else {
        expect().fail("branch should not be reached");
      }
    };
  }

  channel.port2.onmessage = function (event) {
    if (event.data == "noport" || event.data == "zero ports") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(0);
    } else if (event.data == "two ports" || event.data == "entangled ports") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(2);
    } else if (event.data == "done") {
      testTransfers(done);
    } else {
      expect().fail("branch should not be reached");
    }
  };
});

test("gc", () => {
  for (let i = 0; i < 1000; i++) {
    const messageChannel = new MessageChannel();
    messageChannel.port1;
    messageChannel.port2;
  }
});

test("cloneable and transferable equals", async () => {
  const assert = require("assert");
  const mc = new MessageChannel();
  const original = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const buf = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const ab = buf.buffer.transfer();
  expect(ab).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(ab)).toEqual(original);
  const { promise, resolve, reject } = Promise.withResolvers();
  mc.port1.onmessage = ({ data }) => {
    try {
      expect(data).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(data)).toEqual(original);
      mc.port1.close();
      resolve();
    } catch (e) {
      reject(e);
    }
  };
  mc.port2.postMessage(ab);
  await promise;
});

test("cloneable and non-transferable equals (BunFile)", async () => {
  const mc = new MessageChannel();
  const file = Bun.file(import.meta.filename);
  expect(file).toBeInstanceOf(Blob); // Bun.BunFile isnt exposed to JS
  expect(file.name).toEqual(import.meta.filename);
  expect(file.type).toEqual("text/javascript;charset=utf-8");
  const { promise, resolve, reject } = Promise.withResolvers();
  mc.port1.onmessage = ({ data }) => {
    try {
      expect(data).toBeInstanceOf((file as any).__proto__.constructor);
      expect(data.name).toEqual(import.meta.filename);
      expect(data.type).toEqual("text/javascript;charset=utf-8");
      // expect(data).not.toBeEmptyObject();
      mc.port1.close();
      resolve();
    } catch (e) {
      reject(e);
    }
  };
  mc.port2.postMessage(file);
  await promise;
});

test("cloneable and non-transferable equals (net.BlockList)", async () => {
  const net = require("node:net");
  const mc = new MessageChannel();
  const blocklist = new net.BlockList();
  blocklist.addAddress("123.123.123.123");
  const { promise, resolve, reject } = Promise.withResolvers();
  mc.port1.onmessage = ({ data }) => {
    try {
      expect(data).toBeInstanceOf(net.BlockList);
      expect(data.check("123.123.123.123")).toBeTrue();
      expect(!data.check("123.123.123.124")).toBeTrue();
      data.addAddress("123.123.123.124");
      expect(blocklist.check("123.123.123.124")).toBeTrue();
      expect(data.check("123.123.123.124")).toBeTrue();
      mc.port1.close();
      resolve();
    } catch (e) {
      reject(e);
    }
  };
  mc.port2.postMessage(blocklist);
  await promise;
});

// close() sets m_isDetached and then queues the 'close' event as a task. While that
// task is pending, hasPendingActivity() must keep the JS wrapper alive: otherwise a
// GC in that window severs the JSEventListener weak and the dispatch hits a dead
// wrapper (debug: ASSERTION FAILED: m_wrapper).
test("a pending close event survives GC after the port becomes unreachable", async () => {
  let fired = 0;
  for (let i = 0; i < 50; i++) {
    (() => {
      const { port1, port2 } = new MessageChannel();
      port1.addEventListener("close", () => fired++);
      port1.close();
      port2.close();
    })();
    if (i % 10 === 0) Bun.gc(true);
  }
  Bun.gc(true);
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  expect(fired).toBe(50);
});

// The pipe's drain task only holds a weak ref back to this port, so a
// port whose only listener is 'close' must survive GC until the event is delivered.
test("a close event from the peer survives GC of the unreachable port", async () => {
  let fired = 0;
  const peers: MessagePort[] = [];
  for (let i = 0; i < 20; i++) {
    (() => {
      const { port1, port2 } = new MessageChannel();
      port1.addEventListener("close", () => fired++);
      peers.push(port2); // keep only the peer reachable
    })();
  }
  Bun.gc(true);
  Bun.gc(true);
  for (const p of peers) p.close();
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  expect(fired).toBe(20);
});

// A 'close'-listener-only pair pins both ports until the context dies (same as Node,
// which never collects an entangled port). Bound the retention: explicitly-closed pairs
// must still be swept, so a regression that leaks closed ports too would show as growth.
test("explicitly-closed close-listener ports are collected; open ones are pinned like Node", async () => {
  const { heapStats } = require("bun:jsc");
  const count = () => heapStats().objectTypeCounts.MessagePort ?? 0;
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  Bun.gc(true);
  const base = count();
  (() => {
    for (let i = 0; i < 20; i++) {
      const { port1, port2 } = new MessageChannel();
      port1.addEventListener("close", () => {});
      port2.addEventListener("close", () => {});
      port1.close();
      port2.close();
    }
  })();
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  Bun.gc(true);
  Bun.gc(true);
  // All 20 closed pairs must be swept (allow small slack for GC nondeterminism).
  expect(count() - base).toBeLessThanOrEqual(4);
  // Re-baseline: ports left over from earlier tests may be in `base` but get swept by the
  // GCs above (a conservative stack scan kept them past the first GC). Measuring the
  // still-open pairs against `base` then undercounts by that many.
  const afterClosed = count();
  (() => {
    for (let i = 0; i < 20; i++) {
      const { port1, port2 } = new MessageChannel();
      port1.addEventListener("close", () => {});
      port2.addEventListener("close", () => {});
    }
  })();
  Bun.gc(true);
  Bun.gc(true);
  // Node parity: still-open close-listener pairs survive GC (>= 40 ports pinned).
  expect(count() - afterClosed).toBeGreaterThanOrEqual(40);
});

// The peer closed before this side had a listener. The pipe hands over that close only
// once the inbox is empty, so the order of the two registrations does not matter.
test("on('close') before on('message') still delivers queued messages before 'close'", async () => {
  require("worker_threads"); // installs .on/.off on MessagePort
  const { port1, port2 } = new MessageChannel();
  port2.postMessage("m1");
  port2.postMessage("m2");
  port2.close();
  const order: string[] = [];
  const done = Promise.withResolvers<void>();
  port1.on("close", () => {
    order.push("close");
    done.resolve();
  });
  port1.on("message", (m: string) => order.push(m));
  await done.promise;
  expect(order).toEqual(["m1", "m2", "close"]);
});

// A 'message' handler can transfer this port while the peer's close is still behind the
// rest of the inbox. The rest, and then that close, belong to the new owner.
test("transferring a port whose peer already closed preserves the remaining inbox", async () => {
  require("worker_threads");
  const { port1, port2 } = new MessageChannel();
  const carrier = new MessageChannel();
  port2.postMessage("m1");
  port2.postMessage("m2");
  port2.postMessage("m3");
  port2.close();
  const seen: string[] = [];
  const done = Promise.withResolvers<void>();
  carrier.port2.on("message", (received: MessagePort) => {
    received.on("message", (m: string) => seen.push("new:" + m));
    received.on("close", () => done.resolve());
  });
  port1.on("close", () => {});
  port1.on("message", (m: string) => {
    seen.push("old:" + m);
    if (m === "m1") carrier.port1.postMessage(port1, [port1]);
  });
  await done.promise;
  // m1 delivered to the old owner; m2/m3 buffered for the new owner.
  expect(seen).toEqual(["old:m1", "new:m2", "new:m3"]);
});

// The peer's close is handed to each owner of the port in turn. bun only: node rejects this
// transfer with a DataCloneError, because a port that was told of the close is closed there.
test("a port transferred after it was told of its peer's close tells its next owner", async () => {
  require("worker_threads");
  const { port1, port2 } = new MessageChannel();
  const carrier = new MessageChannel();
  const told: string[] = [];
  const first = Promise.withResolvers<void>();
  port1.on("close", () => {
    told.push("first owner");
    first.resolve();
  });
  port2.close();
  await first.promise;
  carrier.port2.on("message", (received: MessagePort) => received.on("close", () => told.push("next owner")));
  carrier.port1.postMessage(port1, [port1]);
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  expect(told).toEqual(["first owner", "next owner"]);
  carrier.port1.close();
});

// The hand-over of the close can move the port: a 'close' listener transfers it, and the next
// owner registers for the close before that listener returns. What the pipe clears after the
// listener must not be the next owner's pending task, which is all that keeps its port alive.
test("a 'close' listener that transfers its own port does not unpin the next owner", async () => {
  const { receiveMessageOnPort } = require("worker_threads");
  const carrier = new MessageChannel();
  const told: string[] = [];
  const nextTold = Promise.withResolvers<void>();
  (() => {
    const { port1, port2 } = new MessageChannel();
    port2.addEventListener("close", function (this: MessagePort) {
      told.push("first owner");
      carrier.port1.postMessage(this, [this]);
      (() => {
        const next: MessagePort = receiveMessageOnPort(carrier.port2)!.message;
        next.addEventListener("close", () => {
          told.push("next owner");
          nextTold.resolve();
        });
      })();
      // After this listener has returned to the pipe, and before the next owner's task.
      queueMicrotask(() => {
        Bun.gc(true);
        Bun.gc(true);
      });
    });
    port1.close();
  })();
  await nextTold.promise;
  expect(told).toEqual(["first owner", "next owner"]);
  carrier.port1.close();
  carrier.port2.close();
});

// The drain task that hands over the peer's close is what keeps a close-only port alive
// between that close and its event.
test("a close event from the peer survives a GC that runs before it is delivered", async () => {
  let closes = 0;
  const peers: MessagePort[] = [];
  (() => {
    for (let i = 0; i < 50; i++) {
      const { port1, port2 } = new MessageChannel();
      port2.addEventListener("close", () => closes++);
      peers.push(port1);
    }
  })();
  await new Promise(r => setImmediate(r));
  for (const peer of peers) peer.close();
  Bun.gc(true);
  Bun.gc(true);
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  expect(closes).toBe(50);
});

// The same order through the web API alone: no node:worker_threads listener methods.
test.each<[string, (port: MessagePort, seen: string[]) => void]>([
  ["onmessage", (port, seen) => (port.onmessage = e => seen.push(e.data))],
  [
    "addEventListener() and start()",
    (port, seen) => {
      port.addEventListener("message", e => seen.push((e as MessageEvent).data));
      port.start();
    },
  ],
])("the peer's 'close' comes after its messages for %s set a loop turn later", async (_name, listen) => {
  const { port1, port2 } = new MessageChannel();
  const seen: string[] = [];
  const closed = Promise.withResolvers<void>();
  port2.addEventListener("close", () => {
    seen.push("close");
    closed.resolve();
  });
  port1.postMessage("a");
  port1.postMessage("b");
  port1.close();
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  expect(seen).toEqual([]);
  listen(port2, seen);
  await closed.promise;
  expect(seen).toEqual(["a", "b", "close"]);
});

// A 'close' listener pins its port until the event lands. The peer's close waits behind
// unread messages, and only script that still holds the port can read them, so an
// unreachable port in that state must not stay pinned until the context dies.
test("a close-listener port with unread messages and a closed peer is collected", async () => {
  const { heapStats } = require("bun:jsc");
  const count = () => heapStats().objectTypeCounts.MessagePort ?? 0;
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  Bun.gc(true);
  const base = count();
  let closes = 0;
  (() => {
    for (let i = 0; i < 20; i++) {
      const { port1, port2 } = new MessageChannel();
      port2.addEventListener("close", () => closes++);
      port1.postMessage("unread");
      port1.close();
    }
  })();
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  Bun.gc(true);
  Bun.gc(true);
  // Allow small slack for GC nondeterminism.
  expect({ closes, pinned: count() - base <= 4 ? "none" : count() - base }).toEqual({ closes: 0, pinned: "none" });
});

// start() and the first assignment of `onmessage` start a port (HTML: they enable its
// message queue). From then on it hands each message to its 'message' listeners, also when
// it has none, and the peer's 'close' follows. Spawned: the process must not have loaded
// node:worker_threads, which other tests of this file do.
test("a port that start() or a first onmessage = null started drops a message it has no listener for", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const turns = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
       const listener = () => {};
       const out = {};
       for (const [name, prepare] of Object.entries({
         "start()": port => port.start(),
         "a first onmessage = null": port => { port.onmessage = null; },
         "onmessage = a function, then an object": port => { port.onmessage = listener; port.onmessage = {}; },
         "a listener added and removed": port => { port.addEventListener("message", listener); port.removeEventListener("message", listener); },
         "nothing": () => {},
       })) {
         const { port1, port2 } = new MessageChannel();
         const seen = [];
         port2.addEventListener("close", () => seen.push("close"));
         prepare(port2);
         port1.postMessage("unread");
         port1.close();
         await turns();
         const withNoListener = seen.slice();
         port2.addEventListener("message", event => seen.push(event.data));
         await turns();
         out[name] = { withNoListener, withOne: seen };
       }
       console.log(JSON.stringify(out));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({
    "start()": { withNoListener: ["close"], withOne: ["close"] },
    "a first onmessage = null": { withNoListener: ["close"], withOne: ["close"] },
    // HTML: a handler that is an object stays the port's listener, also when nothing can call it.
    "onmessage = a function, then an object": { withNoListener: ["close"], withOne: ["close"] },
    "a listener added and removed": { withNoListener: [], withOne: ["unread", "close"] },
    "nothing": { withNoListener: [], withOne: ["unread", "close"] },
  });
  expect(exitCode).toBe(0);
});

// Nothing observes what such a port drops, so it does not outlive its last reference.
test("ports that are receiving with no listener are collected", async () => {
  const { heapStats } = require("bun:jsc");
  const count = () => heapStats().objectTypeCounts.MessagePort ?? 0;
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  Bun.gc(true);
  const base = count();
  (() => {
    for (let i = 0; i < 20; i++) {
      const { port1, port2 } = new MessageChannel();
      port1.start();
      port2.start();
    }
  })();
  Bun.gc(true);
  Bun.gc(true);
  // Allow small slack for GC nondeterminism.
  expect(count() - base).toBeLessThanOrEqual(4);
});

// A listener that was not added (its signal was aborted before) must not count as one: the
// port is neither started nor kept alive for it.
test.each(["message", "close"])(
  "a '%s' listener whose signal was already aborted does not pin its port",
  async type => {
    const { heapStats } = require("bun:jsc");
    const count = () => heapStats().objectTypeCounts.MessagePort ?? 0;
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    Bun.gc(true);
    const base = count();
    const peers: MessagePort[] = [];
    (() => {
      const signal = AbortSignal.abort();
      for (let i = 0; i < 20; i++) {
        const { port1, port2 } = new MessageChannel();
        port2.addEventListener(type, () => {}, { signal });
        peers.push(port1);
      }
    })();
    Bun.gc(true);
    Bun.gc(true);
    // Only the 20 peers that `peers` holds are left. Allow small slack for GC nondeterminism.
    expect(count() - base).toBeLessThanOrEqual(24);
    for (const peer of peers) peer.close();
  },
);

// What keeps an unreachable port alive is the listeners it still has, not the ones it had.
// `peers` holds the other ends, so each port here is alive only while the GC rule says so.
describe("an unreachable port after one of its listeners was removed", () => {
  const undeserializable = () => {
    // Serializes, then fails to deserialize: the DataView is in bounds only once the
    // getter before it has grown the buffer.
    const buffer = new ArrayBuffer(8, { maxByteLength: 65536 });
    return {
      buffer,
      get grow() {
        buffer.resize(65536);
        return 1;
      },
      get view() {
        return new DataView(buffer, 4096, 16);
      },
    };
  };
  // [the listeners' event, whether the port is started, what makes the peer fire that event]
  const kinds = [
    ["close", false, (peer: MessagePort) => peer.close()],
    ["messageerror", true, (peer: MessagePort) => peer.postMessage(undeserializable())],
  ] as const;

  test.each(kinds)("the other '%s' listener still hears the event", async (type, start, fire) => {
    let heard = 0;
    const peers: MessagePort[] = [];
    (() => {
      for (let i = 0; i < 20; i++) {
        const { port1, port2 } = new MessageChannel();
        const removed = () => {};
        port2.addEventListener(type, removed);
        port2.addEventListener(type, () => heard++);
        port2.removeEventListener(type, removed);
        if (start) port2.start();
        peers.push(port1);
      }
    })();
    Bun.gc(true);
    Bun.gc(true);
    for (const peer of peers) fire(peer);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    expect(heard).toBe(20);
    for (const peer of peers) peer.close();
  });

  test.each(kinds)("a port whose only '%s' listener was removed is collected", async (type, start) => {
    const { heapStats } = require("bun:jsc");
    const count = () => heapStats().objectTypeCounts.MessagePort ?? 0;
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    Bun.gc(true);
    const base = count();
    const peers: MessagePort[] = [];
    (() => {
      for (let i = 0; i < 20; i++) {
        const { port1, port2 } = new MessageChannel();
        const removed = () => {};
        port2.addEventListener(type, removed);
        port2.removeEventListener(type, removed);
        if (start) port2.start();
        peers.push(port1);
      }
    })();
    Bun.gc(true);
    Bun.gc(true);
    // Only the 20 peers that `peers` holds are left. Allow small slack for GC nondeterminism.
    expect(count() - base).toBeLessThanOrEqual(24);
    for (const peer of peers) peer.close();
  });

  // Nothing hands a message to a port that is not receiving, so its 'messageerror' listener does not keep it.
  test("a port that is not receiving is collected with its 'messageerror' listener", async () => {
    const { heapStats } = require("bun:jsc");
    const count = () => heapStats().objectTypeCounts.MessagePort ?? 0;
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    Bun.gc(true);
    const base = count();
    const peers: MessagePort[] = [];
    (() => {
      for (let i = 0; i < 20; i++) {
        const { port1, port2 } = new MessageChannel();
        port2.addEventListener("messageerror", () => {});
        peers.push(port1);
      }
    })();
    Bun.gc(true);
    Bun.gc(true);
    expect(count() - base).toBeLessThanOrEqual(24);
    for (const peer of peers) peer.close();
  });

  // The peer's close is already on its way when the port stops receiving: the port lives until it lands.
  test("the 'close' that was on its way when the last 'message' listener was removed still arrives", async () => {
    let heard = 0;
    (() => {
      for (let i = 0; i < 20; i++) {
        const { port1, port2 } = new MessageChannel();
        const removed = () => {};
        port2.addEventListener("message", removed);
        port2.addEventListener("close", () => heard++);
        port1.close();
        port2.removeEventListener("message", removed);
      }
    })();
    Bun.gc(true);
    Bun.gc(true);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    expect(heard).toBe(20);
  });
});

// A port that is receiving hands a message that fails to deserialize to its 'messageerror'
// listeners, also when it has no 'message' listener. Such a port must outlive a GC like a
// listening one, or the event reaches a listener whose wrapper is gone.
test("an unreachable port that is receiving with only a 'messageerror' listener survives a GC and hears it", async () => {
  let errors = 0;
  const peers: MessagePort[] = [];
  (() => {
    for (let i = 0; i < 20; i++) {
      const { port1, port2 } = new MessageChannel();
      port2.addEventListener("messageerror", () => errors++);
      port2.start();
      peers.push(port1);
    }
  })();
  Bun.gc(true);
  Bun.gc(true);
  for (const peer of peers) {
    // Serializes, then fails to deserialize: the DataView is in bounds only once the
    // getter before it has grown the buffer.
    const buffer = new ArrayBuffer(8, { maxByteLength: 65536 });
    peer.postMessage({
      buffer,
      get grow() {
        buffer.resize(65536);
        return 1;
      },
      get view() {
        return new DataView(buffer, 4096, 16);
      },
    });
  }
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  expect(errors).toBe(20);
  for (const peer of peers) peer.close();
});
