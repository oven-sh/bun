import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import { Worker as NodeWorker, type BroadcastChannelEventMap } from "node:worker_threads";
import util from "util";

test("postMessage results in correct event", done => {
  let c1 = new BroadcastChannel("eventType");
  let c2 = new BroadcastChannel("eventType");

  c2.onmessage = e => {
    expect(e).toBeInstanceOf(MessageEvent);
    expect(e.target).toBe(c2);
    expect(e.type).toBe("message");
    expect(e.origin).toBe("");
    expect(e.data).toBe("hello world");
    expect(e.source).toBe(null);
    c1.close();
    c2.close();
    done();
  };

  c1.postMessage("hello world");
});

test("broadcast channel properties", () => {
  let c1 = new BroadcastChannel("props");
  expect(c1.name).toBe("props");
  expect(c1.onmessage).toBe(null);
  expect(c1.onmessageerror).toBe(null);
  expect(c1.close).toBeInstanceOf(Function);
  expect(c1.postMessage).toBeInstanceOf(Function);
  expect(c1.ref).toBeInstanceOf(Function);
  expect(c1.unref).toBeInstanceOf(Function);
  c1.close();
});

test("broadcast channel worker wait", done => {
  var worker = new Worker(new URL("broadcast-channel-worker-simple.ts", import.meta.url).href);
  worker.ref();
  Bun.sleepSync(500);
  var bc = new BroadcastChannel("sleep");
  bc.onmessage = e => {
    expect(e.data).toBe("done!");
    bc.close();
    worker.unref();
    done();
  };
  bc.postMessage("rise and shine!");
});

test("messages are delivered in port creation order", done => {
  let c1 = new BroadcastChannel("order");
  let c2 = new BroadcastChannel("order");
  let c3 = new BroadcastChannel("order");

  let events: BroadcastChannelEventMap["message"][] = [];
  let doneCount = 0;
  let handler = (e: BroadcastChannelEventMap["message"]) => {
    events.push(e);
    if (e.data == "done") {
      doneCount++;
      if (doneCount == 2) {
        expect(events.length).toBe(6);
        expect(events[0].target).toBe(c2);
        expect(events[0].data).toBe("from c1");
        expect(events[1].target).toBe(c3);
        expect(events[1].data).toBe("from c1");
        expect(events[2].target).toBe(c1);
        expect(events[2].data).toBe("from c3");
        expect(events[3].target).toBe(c2);
        expect(events[3].data).toBe("from c3");
        expect(events[4].target).toBe(c1);
        expect(events[4].data).toBe("done");
        expect(events[5].target).toBe(c3);
        expect(events[5].data).toBe("done");
        c1.close();
        c2.close();
        c3.close();
        done();
      }
    }
  };

  c1.onmessage = handler;
  c2.onmessage = handler;
  c3.onmessage = handler;

  c1.postMessage("from c1");
  c3.postMessage("from c3");
  c2.postMessage("done");
});

test("messages aren't deliverd to a closed port.", done => {
  let c1 = new BroadcastChannel("closed");
  let c2 = new BroadcastChannel("closed");
  let c3 = new BroadcastChannel("closed");

  c2.onmessage = () => {
    expect().fail();
  };
  c2.close();
  c3.onmessage = () => {
    c1.close();
    c3.close();
    done();
  };
  c1.postMessage("test");
});

test("close broadcast channel and create another with the same name", done => {
  let c1 = new BroadcastChannel("close-and-create");
  c1.close();
  let c2 = new BroadcastChannel("close-and-create");
  let c3 = new BroadcastChannel("close-and-create");
  c2.onmessage = e => {
    expect(e.data).toBe("done");
    c2.close();
    c3.close();
    done();
  };
  c3.postMessage("done");
});

test("messages aren't delivered to a port closed after calling postMessage.", done => {
  let c1 = new BroadcastChannel("closed");
  let c2 = new BroadcastChannel("closed");
  let c3 = new BroadcastChannel("closed");

  c2.onmessage = () => expect().fail();
  c3.onmessage = () => {
    c1.close();
    c3.close();
    done();
  };
  c1.postMessage("test");
  c2.close();
});

test("closing and creating channels during message delivery works correctly.", done => {
  let c1 = new BroadcastChannel("create-in-onmessage");
  let c2 = new BroadcastChannel("create-in-onmessage");

  c2.onmessage = e => {
    expect(e.data).toBe("first");
    c2.close();
    let c3 = new BroadcastChannel("create-in-onmessage");
    c3.onmessage = event => {
      expect(event.data).toBe("done");
      c1.close();
      c3.close();
      done();
    };
    c1.postMessage("done");
  };
  c1.postMessage("first");
  c2.postMessage("second");
});

test("Closing a channel in onmessage prevents already queued tasks from firing onmessage events", done => {
  let c1 = new BroadcastChannel("close-in-onmessage");
  let c2 = new BroadcastChannel("close-in-onmessage");
  let c3 = new BroadcastChannel("close-in-onmessage");

  let events: string[] = [];
  c1.onmessage = e => events.push("c1: " + e.data);
  c2.onmessage = e => events.push("c2: " + e.data);
  c3.onmessage = e => events.push("c3: " + e.data);

  // c2 closes itself when it receives the first message
  c2.addEventListener("message", e => {
    c2.close();
  });

  c3.addEventListener("message", e => {
    if (e.data == "done") {
      expect(events).toEqual(["c2: first", "c3: first", "c3: done"]);
      c1.close();
      c3.close();
      done();
    }
  });
  c1.postMessage("first");
  c1.postMessage("done");
});

test("broadcast channel used with workers", async () => {
  const batchSize = 1;
  for (let total = 0; total < 100; total++) {
    let bc = new BroadcastChannel("hello test");

    let promises: Promise<void>[] = [];
    let resolveFns: (() => void)[] = [];

    for (var i = 0; i < batchSize; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      promises.push(promise);
      resolveFns.push(resolve);
    }
    bc.onmessage = e => {
      expect(e).toBeInstanceOf(MessageEvent);
      expect(e.target).toBe(bc);
      expect(e.data).toBe("hello from worker");
      const resolve = resolveFns.shift();
      if (resolve) {
        resolve();
      } else {
        console.warn("resolve fn not found");
      }
      console.count("resolve fn called");
    };

    for (let i = 0; i < batchSize; i++) {
      new Worker(new URL("./broadcast-channel-worker.ts", import.meta.url).href);
    }

    await Promise.all(promises);
    bc.close();
    console.count("Batch complete");
  }
}, 99999);

test("objects posted to channels in two workers", async () => {
  using dir = tempDir("broadcast-channel-two-workers", {
    "main.mjs": `import { Worker, isMainThread, parentPort } from "node:worker_threads";
      const bc = new BroadcastChannel("objects");
      if (isMainThread) {
        const workers = [new Worker(new URL(import.meta.url)), new Worker(new URL(import.meta.url))];
        await Promise.all(workers.map(w => new Promise(r => w.once("message", r))));
        for (let r = 0; r < 50; r++) {
          bc.postMessage([{ ["key" + r]: r }]);
          bc.postMessage({ ["obj" + r]: r });
        }
        bc.postMessage("end");
        const counts = await Promise.all(workers.map(w => new Promise(r => w.once("message", r))));
        console.log(counts.join(" "));
        bc.close();
        await Promise.all(workers.map(w => w.terminate()));
      } else {
        const seen = {};
        bc.onmessage = e => {
          if (e.data === "end") {
            bc.close();
            Bun.gc(true);
            parentPort.postMessage(Object.keys(seen).length);
            return;
          }
          for (const obj of Array.isArray(e.data) ? e.data : [e.data]) for (const k in obj) seen[k] = obj[k];
        };
        parentPort.postMessage("ready");
      }`,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "main.mjs"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("100 100");
  expect(exitCode).toBe(0);
});

test("user options are forwarded through custom inspect", () => {
  const bc = new BroadcastChannel("hello");
  expect(util.inspect(bc, { compact: true, breakLength: 2 })).toBe(
    "BroadcastChannel { name:\n   'hello',\n  active:\n   true }",
  );
});

test("custom inspect handles options with numeric keys", () => {
  const bc = new BroadcastChannel("hello");
  bc.unref();
  const inspectCustom = bc[Symbol.for("nodejs.util.inspect.custom")];
  const opts = { 0: "a", 1: "b", depth: 2 };
  expect(inspectCustom.call(bc, 2, opts, util.inspect)).toBe("BroadcastChannel { name: 'hello', active: true }");
  bc.close();
});

const collect = (create: string) => `
  (() => { for (let i = 0; i < 20; i++) ${create}; })();
  Bun.gc(true);
  if (require("bun:jsc").heapStats().objectTypeCounts.BroadcastChannel >= 20) console.log("nothing was collected");`;
const inDroppedRealm = (source: string) => `
  let realm = new ShadowRealm();
  realm.evaluate(${JSON.stringify(source + "; 0")});
  realm = null;
  Bun.gc(true);`;
test.concurrent.each([
  ["a closed channel does not", `const channel = new BroadcastChannel("x"); channel.close(); channel.ref();`, ""],
  ["an open channel that was collected does", collect(`new BroadcastChannel("x")`), "alive\n"],
  ["an open channel that was collected with unref() does not", collect(`new BroadcastChannel("x").unref()`), ""],
  ["an open channel of a realm that was collected does not", inDroppedRealm(`new BroadcastChannel("x")`), ""],
  // A listener for message or for messageerror keeps an open channel alive, and the channel keeps its realm.
  [
    "a channel with onmessage in a realm that script dropped does",
    inDroppedRealm(`new BroadcastChannel("x").onmessage = () => {}`),
    "alive\n",
  ],
  [
    "a channel with onmessageerror in a realm that script dropped does",
    inDroppedRealm(`new BroadcastChannel("x").onmessageerror = () => {}`),
    "alive\n",
  ],
  [
    "a channel with onmessage and unref() in a realm that script dropped does not",
    inDroppedRealm(`const channel = new BroadcastChannel("x"); channel.onmessage = () => {}; channel.unref()`),
    "",
  ],
  [
    "a channel with onmessageerror and unref() in a realm that script dropped does not",
    inDroppedRealm(`const channel = new BroadcastChannel("x"); channel.onmessageerror = () => {}; channel.unref()`),
    "",
  ],
])("%s keep the process alive", async (_, code, expected) => {
  const whenAlive = expected ? `setTimeout(() => (console.log("alive"), process.exit()), 1).unref();` : "";
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code + whenAlive], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
});

// Serializes, then fails to deserialize: the getter grows the buffer after its length was written.
function undeserializable() {
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
}

// An open channel with a listener for `message` or for `messageerror` stays alive:
// https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts
describe("a channel that script reaches only through its messageerror listener", () => {
  // Resolves when every channel of this name has heard of the message.
  async function post(name: string, message: unknown) {
    const sender = new BroadcastChannel(name);
    const last = new BroadcastChannel(name);
    const { promise, resolve } = Promise.withResolvers<void>();
    last.onmessage = event => {
      if (event.data === "last") resolve();
    };
    sender.postMessage(message);
    sender.postMessage("last");
    await promise;
    sender.close();
    last.close();
  }

  test.each([
    [
      "onmessageerror",
      (channel: BroadcastChannel, listener: (event: MessageEvent) => void) => void (channel.onmessageerror = listener),
    ],
    [
      "addEventListener('messageerror')",
      (channel: BroadcastChannel, listener: (event: MessageEvent) => void) =>
        channel.addEventListener("messageerror", listener),
    ],
  ])("hears messageerror after a collection: %s", async (how, listen) => {
    const name = `messageerror only: ${how}`;
    const heard: string[] = [];
    (() => {
      for (let i = 0; i < 8; i++) {
        const channel = new BroadcastChannel(name);
        listen(channel, event => {
          heard.push(`${i}: ${event.type} ${event.data}`);
          channel.close();
        });
      }
    })();
    Bun.gc(true);

    await post(name, undeserializable());
    expect(heard).toEqual(Array.from({ length: 8 }, (_, i) => `${i}: messageerror null`));
  });

  test("hears messageerror after its last message listener is gone", async () => {
    const name = "messageerror outlives message";
    const heard: string[] = [];
    const controller = new AbortController();
    (() => {
      const listening = (how: string) => {
        const channel = new BroadcastChannel(name);
        channel.onmessageerror = () => {
          heard.push(how);
          channel.close();
        };
        return channel;
      };
      const listener = () => {};

      const removed = listening("removeEventListener");
      removed.addEventListener("message", listener);
      removed.removeEventListener("message", listener);

      const cleared = listening("onmessage = null");
      cleared.onmessage = listener;
      cleared.onmessage = null;

      listening("once").addEventListener("message", listener, { once: true });
      listening("signal").addEventListener("message", listener, { signal: controller.signal });
    })();
    await post(name, "fires the once listener");
    controller.abort();
    Bun.gc(true);

    await post(name, undeserializable());
    expect(heard).toEqual(["removeEventListener", "onmessage = null", "once", "signal"]);
  });

  test("hears messageerror for a post from another thread", async () => {
    const name = "messageerror only: worker";
    const worker = new NodeWorker(
      `const heard = [];
       (() => {
         for (let i = 0; i < 8; i++) {
           const channel = new BroadcastChannel(${JSON.stringify(name)});
           channel.onmessageerror = () => {
             heard.push(i);
             channel.close();
           };
         }
       })();
       Bun.gc(true);

       const last = new BroadcastChannel(${JSON.stringify(name)});
       last.onmessage = () => {
         last.close();
         require("node:worker_threads").parentPort.postMessage(heard);
       };
       require("node:worker_threads").parentPort.postMessage("ready");`,
      { eval: true },
    );
    const [ready] = await once(worker, "message");
    const sender = new BroadcastChannel(name);
    sender.postMessage(undeserializable());
    sender.postMessage("last");
    const [heard] = await once(worker, "message");
    sender.close();
    await worker.terminate();

    expect({ ready, heard }).toEqual({ ready: "ready", heard: [0, 1, 2, 3, 4, 5, 6, 7] });
  });
});

test("only a listener for message or for messageerror keeps an open channel from collection", async () => {
  const script = `
    const { heapStats } = require("bun:jsc");
    const count = () => heapStats().objectTypeCounts.BroadcastChannel ?? 0;
    const listener = () => {};
    const shapes = {
      "no listener": channel => {},
      "a listener for another event": channel => channel.addEventListener("other", listener),
      "onmessageerror, then null": channel => {
        channel.onmessageerror = listener;
        channel.onmessageerror = null;
      },
      "a messageerror listener, then removed": channel => {
        channel.addEventListener("messageerror", listener);
        channel.removeEventListener("messageerror", listener);
      },
      "a messageerror listener, then its signal aborted": channel => {
        const controller = new AbortController();
        channel.addEventListener("messageerror", listener, { signal: controller.signal });
        controller.abort();
      },
      "onmessageerror, then close()": channel => {
        channel.onmessageerror = listener;
        channel.close();
      },
      "onmessage": channel => (channel.onmessage = listener),
      "onmessageerror": channel => (channel.onmessageerror = listener),
      "a messageerror listener": channel => channel.addEventListener("messageerror", listener),
    };
    const result = {};
    for (const [shape, listen] of Object.entries(shapes)) {
      Bun.gc(true);
      const before = count();
      (() => {
        for (let i = 0; i < 20; i++) {
          const channel = new BroadcastChannel("x");
          listen(channel);
          channel.unref();
        }
      })();
      Bun.gc(true);
      result[shape] = count() - before >= 10 ? "kept" : "collected";
    }
    console.log(JSON.stringify(result));`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "no listener": "collected",
    "a listener for another event": "collected",
    "onmessageerror, then null": "collected",
    "a messageerror listener, then removed": "collected",
    "a messageerror listener, then its signal aborted": "collected",
    "onmessageerror, then close()": "collected",
    "onmessage": "kept",
    "onmessageerror": "kept",
    "a messageerror listener": "kept",
  });
  expect(exitCode).toBe(0);
});
