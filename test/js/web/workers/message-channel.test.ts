import { bunEnv, bunExe, isASAN, isDebug } from "harness";

test("simple usage", done => {
  const channel = new MessageChannel();
  const port1 = channel.port1;
  const port2 = channel.port2;

  port2.onmessage = (e: MessageEvent) => {
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

  port2.onmessage = (e: MessageEvent) => {
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

  port2.onmessage = (e: MessageEvent) => {
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

  c1.port1.onmessage = (e: MessageEvent) => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 1 port 2");
    port.onmessage = (e: MessageEvent) => {
      expect(e.data).toEqual("hello from channel 1 port 2");
      done();
    };
    port.postMessage("hello from channel 1 port 1", [c1.port1]);
  };

  c1.port2.onmessage = (e: MessageEvent) => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 2 port 1");
    port.postMessage("hello from channel 1 port 2");
  };

  c2.port1.onmessage = (e: MessageEvent) => {
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
  channel.port1.onmessage = (e: MessageEvent) => {
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

    channel0.port2.onmessage = function (event: MessageEvent) {
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

  channel.port2.onmessage = function (event: MessageEvent) {
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
      expect(data).toBeInstanceOf(file.__proto__.constructor);
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

// The peer's notifyPeerClosed() task only holds a weak ref back to this port, so a
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

// registerCloseContext()'s retroactive peer-Closed check posts a peerClosed task before
// attach()'s drain when on('close') precedes on('message'); peerClosed() must still flush
// the queued messages first so 'close' stays terminal.
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

// A 'message' handler running inside peerClosed()'s flush can transfer this port; the
// remaining inbox belongs to the new owner and must not be popped-and-dropped by the
// stale port. flushQueuedMessagesBeforeClose() breaks on m_isDetached to guard this.
test("transferring a port from inside peerClosed()'s flush preserves the remaining inbox", async () => {
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

// https://github.com/oven-sh/bun/issues/32562
// A local MessageChannel port with a message listener must keep the event loop
// alive like Node, even when the unreferenced peer is garbage-collected: node
// never closes a channel because a wrapper was collected. The forced Bun.gc
// makes the collected-peer path deterministic. ref()/unref(), listener
// removal, and messageerror-only modulate the hold.
describe("keeps the event loop alive while a message listener is attached", () => {
  async function streamHasMarker(stream: ReadableStream<Uint8Array>, marker: string) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (!buf.includes(marker)) {
        const { done, value } = await reader.read();
        if (done) return false;
        buf += decoder.decode(value, { stream: true });
      }
      return true;
    } finally {
      reader.releaseLock();
    }
  }

  async function expectStaysAlive(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Drain stderr in the background so debug/ASAN warnings can't fill the OS
    // pipe buffer and deadlock the child while it is expected to stay alive.
    const stderrDrained = proc.stderr.text();
    // Synchronize on delivery (condition, not time) so slow ASAN/debug startup
    // does not race the decision below.
    const gotMarker = await streamHasMarker(proc.stdout, "RECEIVED");
    // After delivery the buggy build exits within milliseconds; a real keep
    // alive hangs. A short window cleanly separates the two.
    const outcome = await Promise.race([
      proc.exited.then(() => "exited" as const),
      Bun.sleep(isDebug || isASAN ? 2000 : 750).then(() => "alive" as const),
    ]);
    proc.kill();
    await Promise.all([stderrDrained, proc.exited]);
    return { gotMarker, outcome };
  }

  async function expectExitsOnItsOwn(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Generous upper bound: a process that exits resolves this fast; the full
    // window only elapses if it wrongly hangs (the failure we are guarding).
    const outcome = await Promise.race([
      proc.exited.then(exitCode => ({ kind: "exited" as const, exitCode, signalCode: proc.signalCode })),
      Bun.sleep(isDebug || isASAN ? 6000 : 2500).then(() => ({
        kind: "alive" as const,
        exitCode: -1,
        signalCode: null,
      })),
    ]);
    if (outcome.kind === "alive") proc.kill();
    await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return outcome;
  }

  test.concurrent(".on('message') stays alive after the unreferenced peer is GC'd", async () => {
    expect(
      await expectStaysAlive(`
        const { MessageChannel } = require("node:worker_threads");
        const { port1 } = (() => {
          const { port1, port2 } = new MessageChannel();
          port1.on("message", () => console.log("RECEIVED"));
          port2.postMessage({ foo: "bar" });
          return { port1 };
        })(); // port2 is now unreferenced
        for (let i = 0; i < 10; i++) Bun.gc(true); // collecting port2 must not close port1
      `),
    ).toEqual({ gotMarker: true, outcome: "alive" });
  });

  test.concurrent("addEventListener('message') (web API) stays alive under GC", async () => {
    expect(
      await expectStaysAlive(`
        const { port1 } = (() => {
          const { port1, port2 } = new MessageChannel();
          port1.addEventListener("message", () => console.log("RECEIVED"));
          port1.start();
          port2.postMessage({ foo: "bar" });
          return { port1 };
        })();
        for (let i = 0; i < 10; i++) Bun.gc(true);
      `),
    ).toEqual({ gotMarker: true, outcome: "alive" });
  });

  test.concurrent(".onmessage setter stays alive under GC", async () => {
    expect(
      await expectStaysAlive(`
        const { port1 } = (() => {
          const { port1, port2 } = new MessageChannel();
          port1.onmessage = () => console.log("RECEIVED");
          port2.postMessage({ foo: "bar" });
          return { port1 };
        })();
        for (let i = 0; i < 10; i++) Bun.gc(true);
      `),
    ).toEqual({ gotMarker: true, outcome: "alive" });
  });

  test.concurrent("unref() releases the hold so the process exits", async () => {
    const { kind, exitCode, signalCode } = await expectExitsOnItsOwn(`
      const { MessageChannel } = require("node:worker_threads");
      const { port1, port2 } = new MessageChannel();
      port1.on("message", () => {});
      port1.unref();
      port2.postMessage({ foo: "bar" });
    `);
    expect({ kind, exitCode, signalCode }).toEqual({ kind: "exited", exitCode: 0, signalCode: null });
  });

  test.concurrent("removing the last message listener lets the process exit", async () => {
    const { kind, exitCode, signalCode } = await expectExitsOnItsOwn(`
      const { MessageChannel } = require("node:worker_threads");
      const { port1, port2 } = new MessageChannel();
      const listener = () => {};
      port1.on("message", listener);
      port1.off("message", listener);
      port2.postMessage({ foo: "bar" });
    `);
    expect({ kind, exitCode, signalCode }).toEqual({ kind: "exited", exitCode: 0, signalCode: null });
  });

  test.concurrent("a second listener added after the peer was GC'd keeps the process alive", async () => {
    // attach() re-runs on every addEventListener; its retroactive peer-close
    // check must not treat a same-context collected sibling as a real close.
    expect(
      await expectStaysAlive(`
        const { MessageChannel } = require("node:worker_threads");
        const { port1 } = (() => {
          const { port1, port2 } = new MessageChannel();
          port1.on("message", () => console.log("RECEIVED"));
          port2.postMessage({ foo: "bar" });
          return { port1 };
        })();
        for (let i = 0; i < 10; i++) Bun.gc(true); // collect port2
        port1.on("message", () => {});             // re-attach must not release the hold
      `),
    ).toEqual({ gotMarker: true, outcome: "alive" });
  });

  test.concurrent("a listener added after a worker-side port was collected is still released", async () => {
    // Cross-context late attach: the worker-side port was collected and the
    // worker is gone, so attaching on main must observe the dead peer and exit.
    const { kind, exitCode, signalCode } = await expectExitsOnItsOwn(`
      const { Worker, MessageChannel } = require("node:worker_threads");
      const channel = new MessageChannel();
      const worker = new Worker(\`
        const { workerData } = require("worker_threads");
        workerData.messagePort = null;             // drop the only ref
        for (let i = 0; i < 10; i++) Bun.gc(true); // collect it inside the worker
      \`, { eval: true, workerData: { messagePort: channel.port2 }, transferList: [channel.port2] });
      worker.on("exit", () => {
        channel.port1.on("message", () => {});     // attach only after the worker is gone
      });
    `);
    expect({ kind, exitCode, signalCode }).toEqual({ kind: "exited", exitCode: 0, signalCode: null });
  });

  test.concurrent("a worker-side port collected before worker exit still releases the main listener", async () => {
    // Cross-context: once the worker-side port is collected, the worker's
    // teardown has nothing left to close, so collection itself must release
    // the listening peer (node delivers this close at worker exit).
    const { kind, exitCode, signalCode } = await expectExitsOnItsOwn(`
      const { Worker, MessageChannel } = require("node:worker_threads");
      const channel = new MessageChannel();
      new Worker(\`
        const { workerData } = require("worker_threads");
        workerData.messagePort.postMessage("Meow");
        workerData.messagePort = null;              // drop the only ref
        for (let i = 0; i < 10; i++) Bun.gc(true);  // collect it before the worker exits
      \`, { eval: true, workerData: { messagePort: channel.port2 }, transferList: [channel.port2] });
      channel.port1.on("message", () => {});
    `);
    expect({ kind, exitCode, signalCode }).toEqual({ kind: "exited", exitCode: 0, signalCode: null });
  });

  test.concurrent("onmessageerror alone does not keep the process alive", async () => {
    const { kind, exitCode, signalCode } = await expectExitsOnItsOwn(`
      const { MessageChannel } = require("node:worker_threads");
      const { port1, port2 } = new MessageChannel();
      port1.onmessageerror = () => {};
      port2.postMessage({ foo: "bar" });
    `);
    expect({ kind, exitCode, signalCode }).toEqual({ kind: "exited", exitCode: 0, signalCode: null });
  });
});
