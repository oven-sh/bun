// Also runs in Node.js (`node --test <file>`), so it uses node:test and imports only Node modules.
// Every expected value is Node's: v22.23.4, v24.22.1, v26.3.0 and v26.12.1 give the same answers.
import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, test } from "node:test";
import { MessageChannel, MessagePort, Worker } from "node:worker_threads";

const isBun = typeof Bun !== "undefined";
const todoOnBun = (reason: string) => (isBun ? { todo: reason } : {});

const f = () => {};
const g = () => {};

function hasRefAfter(order: (port: MessagePort) => void) {
  // The peer stays reachable until the order is done: Bun closes a port whose peer was collected.
  const { port1, port2 } = new MessageChannel();
  try {
    order(port1);
    return port1.hasRef();
  } finally {
    port1.close();
    port2.close();
  }
}

// Node counts the first value that is assigned to onmessage as a 'message' listener, whatever the value is.
// A handler that came and went uses that up, so an order that starts with this depends only on what it names.
function used(port: MessagePort) {
  port.onmessage = g;
  port.onmessage = null;
}

describe("port.onmessage = <not a function> removes the handler and leaves the 'message' listeners ref'd", () => {
  const orders: [name: string, hasRef: boolean, order: (port: MessagePort) => void][] = [
    // The two shapes of the report. Node is also ref'd here through its first-assignment listener.
    ["on(f); onmessage = null", true, port => (port.on("message", f), (port.onmessage = null))],
    ["onmessage = null; on(f)", true, port => ((port.onmessage = null), port.on("message", f))],

    // Another 'message' listener is on the port: it keeps the port ref'd until it goes.
    ["used; on(f); onmessage = null", true, port => (used(port), port.on("message", f), (port.onmessage = null))],
    [
      "used; on(f); onmessage = null; off(f)",
      false,
      port => (used(port), port.on("message", f), (port.onmessage = null), port.off("message", f)),
    ],
    [
      "used; on(f); onmessage = undefined",
      true,
      port => (used(port), port.on("message", f), (port.onmessage = undefined as any)),
    ],
    [
      "used; on(f); onmessage = 'string'",
      true,
      port => (used(port), port.on("message", f), (port.onmessage = "string" as any)),
    ],
    [
      "used; addEventListener(f); onmessage = null",
      true,
      port => (used(port), port.addEventListener("message", f), (port.onmessage = null)),
    ],
    ["used; once(f); onmessage = null", true, port => (used(port), port.once("message", f), (port.onmessage = null))],
    [
      "used; on(f); onmessage = g; onmessage = null",
      true,
      port => (used(port), port.on("message", f), (port.onmessage = g), (port.onmessage = null)),
    ],
    [
      "used; onmessage = g; on(f); onmessage = null",
      true,
      port => (used(port), (port.onmessage = g), port.on("message", f), (port.onmessage = null)),
    ],
    [
      "used; on(f); onmessage = g; onmessage = null; off(f)",
      false,
      port => (
        used(port),
        port.on("message", f),
        (port.onmessage = g),
        (port.onmessage = null),
        port.off("message", f)
      ),
    ],
    [
      "used; ref(); on(f); onmessage = null",
      true,
      port => (used(port), port.ref(), port.on("message", f), (port.onmessage = null)),
    ],
    [
      "used; ref(); on(f); onmessage = null; off(f)",
      false,
      port => (used(port), port.ref(), port.on("message", f), (port.onmessage = null), port.off("message", f)),
    ],
    [
      "used; ref(); on(f); off(f); onmessage = null",
      false,
      port => (used(port), port.ref(), port.on("message", f), port.off("message", f), (port.onmessage = null)),
    ],

    // The handler was the last 'message' listener: the port is unref'd, ref() or not.
    ["onmessage = g; onmessage = null", false, port => ((port.onmessage = g), (port.onmessage = null))],
    ["onmessage = g; onmessage = 'string'", false, port => ((port.onmessage = g), (port.onmessage = "string" as any))],
    ["onmessage = f; onmessage = g; onmessage = null", false, port => ((port.onmessage = f), used(port))],
    ["ref(); onmessage = g; onmessage = null", false, port => (port.ref(), used(port))],
    [
      "onmessage = g; ref(); onmessage = null",
      false,
      port => ((port.onmessage = g), port.ref(), (port.onmessage = null)),
    ],
    // unref() stays in force when a handler came and went.
    [
      "on(f); unref(); onmessage = g; onmessage = null",
      false,
      port => (port.on("message", f), port.unref(), used(port)),
    ],
    // null gives the handler's hold back, also when removeAllListeners() came between.
    [
      "onmessage = g; removeAllListeners(); on(f); onmessage = null; off(f)",
      false,
      port => (
        (port.onmessage = g),
        port.removeAllListeners(),
        port.on("message", f),
        (port.onmessage = null),
        port.off("message", f)
      ),
    ],

    // An object that is not callable can never run. As a handler's replacement it unrefs the port.
    ["onmessage = g; onmessage = {}", false, port => ((port.onmessage = g), (port.onmessage = {} as any))],
    [
      "ref(); onmessage = g; onmessage = {}",
      false,
      port => (port.ref(), (port.onmessage = g), (port.onmessage = {} as any)),
    ],
    [
      "onmessage = g; ref(); onmessage = {}",
      false,
      port => ((port.onmessage = g), port.ref(), (port.onmessage = {} as any)),
    ],
    [
      "unref(); onmessage = g; onmessage = {}",
      false,
      port => (port.unref(), (port.onmessage = g), (port.onmessage = {} as any)),
    ],
    [
      "on(f); unref(); onmessage = g; onmessage = {}",
      false,
      port => (port.on("message", f), port.unref(), (port.onmessage = g), (port.onmessage = {} as any)),
    ],

    // A function handler keeps the port ref'd, after unref() too.
    ["onmessage = g", true, port => (port.onmessage = g)],
    ["unref(); onmessage = g", true, port => (port.unref(), (port.onmessage = g))],
    ["onmessage = f; unref(); onmessage = g", true, port => ((port.onmessage = f), port.unref(), (port.onmessage = g))],
    ["unref(); on(f); onmessage = g", true, port => (port.unref(), port.on("message", f), (port.onmessage = g))],
  ];

  test("hasRef() after each order", () => {
    const actual = Object.fromEntries(orders.map(([name, , order]) => [name, hasRefAfter(order)]));
    assert.deepStrictEqual(actual, Object.fromEntries(orders.map(([name, hasRef]) => [name, hasRef])));
  });

  // Every order of up to four of these calls, after a handler came and went. No call here is ref(), unref() or a
  // function assignment, so the port is ref'd exactly while a listener is attached.
  test("hasRef() follows the attached listeners through every order of listener changes and non-function values", () => {
    const k = () => {};
    const calls: [name: string, call: (port: MessagePort) => void, attached: (listeners: Set<() => void>) => void][] = [
      ["on(f)", port => port.on("message", f), listeners => listeners.add(f)],
      ["off(f)", port => port.off("message", f), listeners => listeners.delete(f)],
      ["addEventListener(k)", port => port.addEventListener("message", k), listeners => listeners.add(k)],
      ["removeEventListener(k)", port => port.removeEventListener("message", k), listeners => listeners.delete(k)],
      ["onmessage = null", port => (port.onmessage = null), () => {}],
      ["onmessage = 'string'", port => (port.onmessage = "string" as any), () => {}],
    ];
    const wrong: string[] = [];
    let count = 0;
    (function each(order: number[]) {
      const listeners = new Set<() => void>();
      const hasRef = hasRefAfter(port => {
        used(port);
        for (const i of order) {
          calls[i][1](port);
          calls[i][2](listeners);
        }
      });
      count++;
      if (hasRef !== listeners.size > 0) wrong.push(order.map(i => calls[i][0]).join("; "));
      if (order.length < 4) for (let i = 0; i < calls.length; i++) each([...order, i]);
    })([]);
    assert.deepStrictEqual(
      { count, wrong: wrong.length, first: wrong.slice(0, 5) },
      { count: 1555, wrong: 0, first: [] },
    );
  });

  test(
    "ref() keeps the port ref'd when onmessage = null removes nothing",
    todoOnBun("the setter gives back the hold of ref(): nothing else does when the last 'message' listener goes"),
    () => {
      assert.strictEqual(
        hasRefAfter(port => (used(port), port.ref(), (port.onmessage = null))),
        true,
      );
    },
  );

  test(
    "removeEventListener(f) removes a listener that on(f) added, so the port is unref'd with its handler",
    todoOnBun("on(f) registers a wrapper of f: removeEventListener(f) removes nothing and f still listens"),
    () => {
      const hasRef = hasRefAfter(port => {
        port.onmessage = g;
        port.on("message", f);
        port.removeEventListener("message", f);
        port.onmessage = null;
      });
      assert.strictEqual(hasRef, false);
    },
  );

  test(
    "an object that is not callable removes the handler like null",
    todoOnBun("a non-callable object stays a listener that never runs, and the setter still unrefs the port for it"),
    () => {
      assert.strictEqual(
        hasRefAfter(port => (port.on("message", f), (port.onmessage = {} as any))),
        true,
      );
    },
  );
});

// Runs `script` in its own process, with `port1` and `port2` of a fresh channel in scope, and resolves with what it
// printed. `later(fn)` is an unref'd timer: it runs only when the port holds the loop open. A process that exited too
// early has no other way to say so. The last timer bounds the other failure, a process that never exits.
async function inOwnProcess(script: string) {
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      "-e",
      `const { MessageChannel } = require("node:worker_threads");
       const { port1, port2 } = new MessageChannel();
       globalThis.keep = port2;
       const later = fn => setTimeout(fn, 100).unref();
       const got = message => { console.log("got " + message); port1.close(); };
       ${script}
       setTimeout(() => { console.log("still alive"); process.exit(1); }, 3_000).unref();`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  const [code, signal] = await once(child, "close");
  return { stdout: stdout.trim(), code, signal };
}

describe("the process of a port whose onmessage lost its handler", () => {
  const ended = (stdout: string) => ({ stdout, code: 0, signal: null });
  const delivered = ended("got late");

  async function inOwnProcesses(rows: [name: string, script: string, expected: typeof delivered][]) {
    const results = await Promise.all(rows.map(([, script]) => inOwnProcess(script)));
    assert.deepStrictEqual(
      Object.fromEntries(rows.map(([name], i) => [name, results[i]])),
      Object.fromEntries(rows.map(([name, , expected]) => [name, expected])),
    );
  }

  test("stays alive for the 'message' listeners and gets the next message", async () => {
    await inOwnProcesses([
      [
        "on(got); onmessage = null",
        `port1.on("message", got); port1.onmessage = null; later(() => port2.postMessage("late"));`,
        delivered,
      ],
      [
        "onmessage = null; on(got)",
        `port1.onmessage = null; port1.on("message", got); later(() => port2.postMessage("late"));`,
        delivered,
      ],
      [
        "onmessage = g; onmessage = null; addEventListener(got)",
        `port1.onmessage = () => {}; port1.onmessage = null;
         port1.addEventListener("message", event => got(event.data));
         later(() => port2.postMessage("late"));`,
        delivered,
      ],
      // A function handler next to a listener keeps the port ref'd after unref().
      [
        "unref(); on(got); onmessage = g",
        `port1.unref(); port1.on("message", got); port1.onmessage = () => {}; later(() => port2.postMessage("late"));`,
        delivered,
      ],
    ]);
  });

  test("ends by itself when no listener is left or unref() is in force", async () => {
    await inOwnProcesses([
      [
        "onmessage = g; onmessage = null",
        `port1.onmessage = () => {}; port1.onmessage = null; console.log("hasRef=" + port1.hasRef());`,
        ended("hasRef=false"),
      ],
      [
        "onmessage = f; onmessage = g; onmessage = null",
        `port1.onmessage = () => {}; port1.onmessage = () => {}; port1.onmessage = null;
         console.log("hasRef=" + port1.hasRef());`,
        ended("hasRef=false"),
      ],
      [
        "on(f); unref(); onmessage = g; onmessage = null",
        `port1.on("message", () => {}); port1.unref(); port1.onmessage = () => {}; port1.onmessage = null;
         console.log("hasRef=" + port1.hasRef());`,
        ended("hasRef=false"),
      ],
      [
        "onmessage = g; onmessage = null; ref(); on(f); off(f); onmessage = null",
        `const f = () => {};
         port1.onmessage = () => {}; port1.onmessage = null;
         port1.ref(); port1.on("message", f); port1.off("message", f); port1.onmessage = null;
         console.log("hasRef=" + port1.hasRef());`,
        ended("hasRef=false"),
      ],
    ]);
  });

  test("ends by itself when the port is closed, transferred or collected", async () => {
    // Twenty ports listen, their peers close, and the ports are collected before the close reaches them.
    const collected = (listen: string) =>
      `(function () {
         for (let i = 0; i < 20; i++) {
           const channel = new MessageChannel();
           const port = channel.port2;
           ${listen}
           channel.port1.close();
         }
       })();
       gc(); gc(); console.log("done");`;
    await inOwnProcesses([
      // A port that is closed or transferred takes no hold for a handler.
      ["close(); onmessage = g", `port1.close(); port1.onmessage = () => {}; console.log("done");`, ended("done")],
      [
        "transfer; onmessage = g",
        `const carrier = new MessageChannel();
         carrier.port1.postMessage(null, [port1]);
         port1.onmessage = () => {};
         carrier.port1.close();
         console.log("done");`,
        ended("done"),
      ],
      // A listening port that is collected gives the loop back, with or without a cleared handler.
      ["on(f); peer close(); collected", collected(`port.on("message", () => {});`), ended("done")],
      [
        "on(f); onmessage = null; peer close(); collected",
        collected(`port.on("message", () => {}); port.onmessage = null;`),
        ended("done"),
      ],
    ]);
  });
});

describe("a worker keeps its parentPort listener when parentPort.onmessage loses its handler", () => {
  // Resolves with what the worker posted. The parent posts `reply` after the first message, so the worker's
  // script and its first handler are done by then. A worker that exits early ends the wait with what it had posted.
  async function messagesOf(source: string, { first, reply }: { first?: string; reply: string }) {
    const worker = new Worker(source, { eval: true });
    const messages: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    worker.on("message", message => {
      messages.push(message);
      if (messages.length === 1) worker.postMessage(reply);
      else resolve();
    });
    worker.on("error", reject);
    worker.on("exit", () => resolve());
    if (first !== undefined) worker.postMessage(first);
    await promise;
    await worker.terminate();
    return messages;
  }

  test("parentPort.on(f); parentPort.onmessage = null", async () => {
    const messages = await messagesOf(
      `const { parentPort } = require("node:worker_threads");
       parentPort.on("message", message => parentPort.postMessage("got " + message));
       parentPort.onmessage = null;
       parentPort.postMessage("hasRef=" + parentPort.hasRef());`,
      { reply: "late" },
    );
    assert.deepStrictEqual(messages, ["hasRef=true", "got late"]);
  });

  // A one-shot handshake: the handler takes the first message, removes itself and attaches the listener for the rest.
  test("an onmessage handler that sets onmessage = null and then adds a listener", async () => {
    const messages = await messagesOf(
      `const { parentPort } = require("node:worker_threads");
       parentPort.onmessage = ({ data }) => {
         parentPort.onmessage = null;
         parentPort.on("message", job => parentPort.postMessage("job " + job));
         parentPort.postMessage(data + ", hasRef=" + parentPort.hasRef());
       };`,
      { first: "ready", reply: "1" },
    );
    assert.deepStrictEqual(messages, ["ready, hasRef=true", "job 1"]);
  });
});
