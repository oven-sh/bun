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

    // An object that is not callable can never run. As a handler's replacement it unrefs the port, and it holds nothing.
    ["used; onmessage = {}", false, port => (used(port), (port.onmessage = {} as any))],
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
    [
      "used; on(f); onmessage = {}; off(f)",
      false,
      port => (used(port), port.on("message", f), (port.onmessage = {} as any), port.off("message", f)),
    ],
    // A function takes the object's place and holds the port again.
    ["onmessage = {}; onmessage = g", true, port => ((port.onmessage = {} as any), (port.onmessage = g))],
    [
      "used; on(f); onmessage = {}; onmessage = g; onmessage = null; off(f)",
      false,
      port => (
        used(port),
        port.on("message", f),
        (port.onmessage = {} as any),
        (port.onmessage = g),
        (port.onmessage = null),
        port.off("message", f)
      ),
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
    "an object that is not callable leaves the other 'message' listeners ref'd, like null",
    todoOnBun(
      "a non-callable object stays a counted listener that never runs, so the setter unrefs the whole port for it",
    ),
    () => {
      const inert = {} as any;
      assert.deepStrictEqual(
        {
          "used; on(f); onmessage = {}": hasRefAfter(
            port => (used(port), port.on("message", f), (port.onmessage = inert)),
          ),
          "used; onmessage = {}; on(f)": hasRefAfter(
            port => (used(port), (port.onmessage = inert), port.on("message", f)),
          ),
          "used; on(f); onmessage = {}; onmessage = null": hasRefAfter(
            port => (used(port), port.on("message", f), (port.onmessage = inert), (port.onmessage = null)),
          ),
        },
        {
          "used; on(f); onmessage = {}": true,
          "used; onmessage = {}; on(f)": true,
          "used; on(f); onmessage = {}; onmessage = null": true,
        },
      );
    },
  );

  // What makes the test above pass must keep this: the object stays where the handler was, and it never runs.
  test("a non-callable object keeps the handler's place in the listener list", async () => {
    const { port1, port2 } = new MessageChannel();
    const calls: (number | string)[] = [];
    const inert: any = { handleEvent: () => calls.push("inert") };
    const { promise, resolve } = Promise.withResolvers<void>();
    port1.addEventListener("message", () => calls.push(1));
    port1.onmessage = () => calls.push("first handler");
    port1.onmessage = inert;
    const getter = port1.onmessage === inert;
    port1.addEventListener("message", () => calls.push(3));
    port1.onmessage = () => calls.push(2);
    port1.addEventListener("message", () => (calls.push(4), resolve()));
    port2.postMessage(null);
    await promise;
    port1.close();
    port2.close();
    assert.deepStrictEqual({ getter, calls }, { getter: true, calls: [1, 2, 3, 4] });
  });
});

// Runs `script` as a module in its own process and resolves with the lines it printed. The last timer bounds a
// process that never exits.
async function inOwnProcess(script: string) {
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      "-e",
      `import { MessageChannel } from "node:worker_threads";
       ${script}
       setTimeout(() => { console.log("still alive"); process.exit(1); }, 3_000).unref();`,
    ],
    { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  const [code, signal] = await once(child, "close");
  return { stdout: stdout.trim().split("\n"), code, signal };
}

describe("the process of a port whose onmessage lost its handler", () => {
  // The source of an array of [name, (port, got) => { order }] for a child process.
  const asSource = (orders: [name: string, order: string][]) =>
    `[${orders.map(([name, order]) => `[${JSON.stringify(name)}, (port, got) => { ${order} }]`).join(", ")}]`;

  test("stays alive for the 'message' listeners and gets the next message", async () => {
    const steps: [name: string, order: string][] = [
      ["on(got); onmessage = null", `port.on("message", got); port.onmessage = null;`],
      ["onmessage = null; on(got)", `port.onmessage = null; port.on("message", got);`],
      [
        "onmessage = g; onmessage = null; addEventListener(got)",
        `port.onmessage = () => {}; port.onmessage = null; port.addEventListener("message", event => got(event.data));`,
      ],
      // A function handler next to a listener keeps the port ref'd after unref().
      ["unref(); on(got); onmessage = g", `port.unref(); port.on("message", got); port.onmessage = () => {};`],
    ];
    // One port after the other. The timer is unref'd: it runs only when the port of that step holds the loop open.
    // A process that exited too early has no other way to say so, and its output stops at that step.
    const result = await inOwnProcess(
      `const steps = ${asSource(steps)};
       const peers = [];
       (function step(i) {
         if (i === steps.length) return;
         const [name, order] = steps[i];
         const { port1, port2 } = new MessageChannel();
         peers.push(port2);
         order(port1, message => { console.log(name + ": got " + message); port1.close(); step(i + 1); });
         setTimeout(() => port2.postMessage("late"), 100).unref();
       })(0);`,
    );
    assert.deepStrictEqual(result, { stdout: steps.map(([name]) => `${name}: got late`), code: 0, signal: null });
  });

  test("ends by itself when no listener is left or unref() is in force", async () => {
    const orders: [name: string, order: string][] = [
      ["onmessage = g; onmessage = null", `port.onmessage = () => {}; port.onmessage = null;`],
      ["onmessage = g; onmessage = {}", `port.onmessage = () => {}; port.onmessage = {};`],
      [
        "onmessage = f; onmessage = g; onmessage = null",
        `port.onmessage = () => {}; port.onmessage = () => {}; port.onmessage = null;`,
      ],
      [
        "on(f); unref(); onmessage = g; onmessage = null",
        `port.on("message", () => {}); port.unref(); port.onmessage = () => {}; port.onmessage = null;`,
      ],
      [
        "onmessage = g; onmessage = null; ref(); on(f); off(f); onmessage = null",
        `const f = () => {};
         port.onmessage = () => {}; port.onmessage = null;
         port.ref(); port.on("message", f); port.off("message", f); port.onmessage = null;`,
      ],
    ];
    const result = await inOwnProcess(
      `const peers = [];
       for (const [name, order] of ${asSource(orders)}) {
         const { port1, port2 } = new MessageChannel();
         peers.push(port2);
         order(port1);
         console.log(name + ": hasRef=" + port1.hasRef());
       }`,
    );
    assert.deepStrictEqual(result, { stdout: orders.map(([name]) => `${name}: hasRef=false`), code: 0, signal: null });
  });

  // A port that is closed or transferred takes no hold for a handler.
  test("ends by itself when the port is closed or transferred", async () => {
    const result = await inOwnProcess(
      `const closed = new MessageChannel();
       closed.port1.close();
       closed.port1.onmessage = () => {};
       const transferred = new MessageChannel(), carrier = new MessageChannel();
       carrier.port1.postMessage(null, [transferred.port1]);
       transferred.port1.onmessage = () => {};
       carrier.port1.close();
       console.log("done");`,
    );
    assert.deepStrictEqual(result, { stdout: ["done"], code: 0, signal: null });
  });

  // Bun collects a listening port whose peer closed, and it can do that before the port hears of the close.
  test("ends by itself when the peers of its listening ports have closed", async () => {
    const results = await Promise.all([
      // The module's last statement closes the peer. Bun collects once more when the entry module is done.
      inOwnProcess(
        `function listen() {
           const { port1, port2 } = new MessageChannel();
           port2.on("message", () => {});
           return port1;
         }
         const sender = listen();
         await new Promise(resolve => setImmediate(resolve));
         sender.close();
         console.log("closed");`,
      ),
      // Twenty ports, with and without a cleared handler, and a collection in the same turn. The port that is still
      // open keeps its own hold: the timer is unref'd and runs only for it.
      inOwnProcess(
        `const live = new MessageChannel();
         live.port1.on("message", message => { console.log("live: got " + message); live.port1.close(); });
         (function () {
           for (let i = 0; i < 20; i++) {
             const { port1, port2 } = new MessageChannel();
             port2.on("message", () => {});
             if (i % 2) port2.onmessage = null;
             port1.close();
           }
         })();
         gc(); gc(); console.log("done");
         setTimeout(() => live.port2.postMessage("late"), 100).unref();`,
      ),
    ]);
    assert.deepStrictEqual(results, [
      { stdout: ["closed"], code: 0, signal: null },
      { stdout: ["done", "live: got late"], code: 0, signal: null },
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
