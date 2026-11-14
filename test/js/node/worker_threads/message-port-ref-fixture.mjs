// hasRef() of a MessagePort after an order of ref(), unref() and 'message' listener changes.
// worker_threads.test.ts calls hasRefGrid() in its own process, and runs this file under
// node as a script, so it asserts one table for both and marks the rows where they differ.
import { MessageChannel } from "node:worker_threads";

const f = () => {};
const g = () => {};

// A row gets a fresh channel: the port under test and its peer. A row with "msg" posts one
// message from the peer and waits until its own listener ran. It never adds a listener of
// its own to wait, because that would change the listener count under test.
const rows = {
  // The last 'message' listener goes after an explicit ref().
  "ref; on; off": p => {
    p.ref();
    p.on("message", f);
    p.off("message", f);
  },
  "on; ref; off": p => {
    p.on("message", f);
    p.ref();
    p.off("message", f);
  },
  "on; unref; ref; off": p => {
    p.on("message", f);
    p.unref();
    p.ref();
    p.off("message", f);
  },
  "ref; addEventListener; removeEventListener": p => {
    p.ref();
    p.addEventListener("message", f);
    p.removeEventListener("message", f);
  },
  "ref; addEventListener with a signal; abort": p => {
    const controller = new AbortController();
    p.ref();
    p.addEventListener("message", f, { signal: controller.signal });
    controller.abort();
  },
  "ref; once; msg": async (p, q) => {
    p.ref();
    const ran = new Promise(resolve => p.once("message", resolve));
    q.postMessage(1);
    await ran;
  },
  "once; ref; msg": async (p, q) => {
    const ran = new Promise(resolve => p.once("message", resolve));
    p.ref();
    q.postMessage(1);
    await ran;
  },
  "once; unref; ref; msg": async (p, q) => {
    const ran = new Promise(resolve => p.once("message", resolve));
    p.unref();
    p.ref();
    q.postMessage(1);
    await ran;
  },
  "ref; addEventListener once; msg": async (p, q) => {
    p.ref();
    const ran = new Promise(resolve => p.addEventListener("message", resolve, { once: true }));
    q.postMessage(1);
    await ran;
  },
  "ref; addEventListener once; dispatchEvent": p => {
    p.ref();
    p.addEventListener("message", f, { once: true });
    p.dispatchEvent(new MessageEvent("message", { data: 1 }));
  },
  "on; ref; off inside the listener; msg": async (p, q) => {
    const { promise: ran, resolve } = Promise.withResolvers();
    const listener = () => {
      p.off("message", listener);
      resolve();
    };
    p.on("message", listener);
    p.ref();
    q.postMessage(1);
    await ran;
  },
  // One dispatch removes both once listeners, one removal each.
  "ref; once f; once g; msg": async (p, q) => {
    p.ref();
    p.once("message", f);
    const ran = new Promise(resolve => p.once("message", resolve));
    q.postMessage(1);
    await ran;
  },
  // A once listener is removed before it runs, so the port is released by then.
  "ref; once; msg; hasRef() inside the listener": async (p, q) => {
    p.ref();
    const seen = new Promise(resolve => p.once("message", () => resolve(p.hasRef())));
    q.postMessage(1);
    return await seen;
  },

  // Not the last 'message' listener, or not a 'message' listener: nothing is released.
  "ref": p => {
    p.ref();
  },
  "on": p => {
    p.on("message", f);
  },
  "ref; on f; on g; off f": p => {
    p.ref();
    p.on("message", f);
    p.on("message", g);
    p.off("message", f);
  },
  "ref; off (never added)": p => {
    p.ref();
    p.off("message", f);
  },
  "ref; on close; off close": p => {
    p.ref();
    p.on("close", f);
    p.off("close", f);
  },
  "ref; on messageerror; off messageerror": p => {
    p.ref();
    p.on("messageerror", f);
    p.off("messageerror", f);
  },

  // The release is not sticky: a later listener or ref() refs the port again.
  "on; off; on": p => {
    p.on("message", f);
    p.off("message", f);
    p.on("message", f);
  },
  "ref; on; off; on": p => {
    p.ref();
    p.on("message", f);
    p.off("message", f);
    p.on("message", g);
  },
  "ref; on; off; ref": p => {
    p.ref();
    p.on("message", f);
    p.off("message", f);
    p.ref();
  },
  "ref; once; msg; on inside the listener": async (p, q) => {
    p.ref();
    const { promise: ran, resolve } = Promise.withResolvers();
    p.once("message", () => {
      p.on("message", g);
      resolve();
    });
    q.postMessage(1);
    await ran;
  },
  "ref; once; msg; ref inside the listener": async (p, q) => {
    p.ref();
    const { promise: ran, resolve } = Promise.withResolvers();
    p.once("message", () => {
      p.ref();
      resolve();
    });
    q.postMessage(1);
    await ran;
  },

  // No ref() involved.
  "(nothing)": () => {},
  "on; off": p => {
    p.on("message", f);
    p.off("message", f);
  },
  "on; unref": p => {
    p.on("message", f);
    p.unref();
  },
  "ref; unref": p => {
    p.ref();
    p.unref();
  },
  "once; msg": async (p, q) => {
    const ran = new Promise(resolve => p.once("message", resolve));
    q.postMessage(1);
    await ran;
  },

  // removeAllListeners().
  "on; removeAllListeners(message)": p => {
    p.on("message", f);
    p.removeAllListeners("message");
  },
  "on; removeAllListeners()": p => {
    p.on("message", f);
    p.removeAllListeners();
  },
  "ref; on; removeAllListeners(message)": p => {
    p.ref();
    p.on("message", f);
    p.removeAllListeners("message");
  },
  "ref; on; removeAllListeners()": p => {
    p.ref();
    p.on("message", f);
    p.removeAllListeners();
  },
  "on; ref; removeAllListeners(message) inside the listener; msg": async (p, q) => {
    const { promise: ran, resolve } = Promise.withResolvers();
    p.on("message", () => {
      p.removeAllListeners("message");
      resolve();
    });
    p.ref();
    q.postMessage(1);
    await ran;
  },
  "ref; on; removeAllListeners(close)": p => {
    p.ref();
    p.on("message", f);
    p.removeAllListeners("close");
  },

  // The first listener after unref().
  "unref; on": p => {
    p.unref();
    p.on("message", f);
  },
  "on; unref; on g": p => {
    p.on("message", f);
    p.unref();
    p.on("message", g);
  },

  // The onmessage setter.
  "onmessage = f": p => {
    p.onmessage = f;
  },
  "onmessage = f; onmessage = null": p => {
    p.onmessage = f;
    p.onmessage = null;
  },
  "onmessage = f; onmessage = 'string'": p => {
    p.onmessage = f;
    p.onmessage = "string";
  },
  "onmessage = f; onmessage = {}": p => {
    p.onmessage = f;
    p.onmessage = {};
  },
  "ref; onmessage = f; onmessage = null": p => {
    p.ref();
    p.onmessage = f;
    p.onmessage = null;
  },
  "onmessage = f; unref; onmessage = g": p => {
    p.onmessage = f;
    p.unref();
    p.onmessage = g;
  },
  "on f; unref; onmessage = g; onmessage = null": p => {
    p.on("message", f);
    p.unref();
    p.onmessage = g;
    p.onmessage = null;
  },
  "on f; onmessage = g; onmessage = {}; off f": p => {
    p.on("message", f);
    p.onmessage = g;
    p.onmessage = {};
    p.off("message", f);
  },
  "onmessage = g; on f; removeEventListener f; onmessage = null": p => {
    p.onmessage = g;
    p.on("message", f);
    p.removeEventListener("message", f);
    p.onmessage = null;
  },
  "ref; onmessage = null": p => {
    p.ref();
    p.onmessage = null;
  },
  "on f; onmessage = null": p => {
    p.on("message", f);
    p.onmessage = null;
  },
  "on f; onmessage = g; onmessage = null": p => {
    p.on("message", f);
    p.onmessage = g;
    p.onmessage = null;
  },
  "ref; on f; onmessage = null": p => {
    p.ref();
    p.on("message", f);
    p.onmessage = null;
  },
  "onmessage = {}": p => {
    p.onmessage = {};
  },
  "onmessage = f; onmessage = {}; on g": p => {
    p.onmessage = f;
    p.onmessage = {};
    p.on("message", g);
  },
  "onmessage = null; ref; on f; off f": p => {
    p.onmessage = null;
    p.ref();
    p.on("message", f);
    p.off("message", f);
  },
};

export async function hasRefGrid() {
  const report = {};
  for (const [name, row] of Object.entries(rows)) {
    // The peer stays reachable until the row is done: collecting it would close the port.
    const { port1, port2 } = new MessageChannel();
    try {
      const seen = await row(port1, port2);
      report[name] = typeof seen === "boolean" ? seen : port1.hasRef();
    } finally {
      port1.close();
      port2.close();
    }
  }
  return report;
}

if (import.meta.main) {
  console.log(JSON.stringify(await hasRefGrid()));
  process.exit(0);
}
