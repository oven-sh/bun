// A MessagePort is receiving from start(), or from its first 'message' listener, until its last
// 'message' listener is removed (node's `receiving_messages_`). While it is receiving it hands each
// message to its listeners, also when it has none: the message is gone. While it is not, messages
// wait for the next start() or for receiveMessageOnPort(), and the peer's close waits behind them.
//
// This file also runs under Node.js (`node --test`), which is where the expected values come from.
import assert from "node:assert";
import { once } from "node:events";
import { describe, test } from "node:test";
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";

const isBun = typeof Bun !== "undefined";

const turns = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve));
};
const listener = () => {};
const aborted = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

// node refs a port for the wrapper listener of a first `onmessage` that is no function, and keeps
// the ref of the listeners that removeAllListeners() drops. Its process then never exits. Bun
// holds the event loop only for a 'message' listener that can run, or for ref().
const noRef = { hasRef: false };
// In node `onmessage` counts as a listener only while it is a function. Here, as in HTML, a handler
// that is an object stays a listener, so the port keeps handing messages to it.
const objectListens = { message: "gone" as const };
// node's removeAllListeners() also forgets the wrapper listener of `onmessage`. Here it removes
// the listeners of on() and once() alone, and a first `onmessage` that was no function still counts.
const wrapperStays = { todo: "removeAllListeners() does not forget what a first onmessage = <no function> started" };

type Row = [
  name: string,
  prepare: (port: any) => void,
  // node: what happens to one message that is posted next, and hasRef() before it.
  message: "kept" | "gone",
  hasRef: boolean,
  bun?: { message?: "kept" | "gone"; hasRef?: boolean; todo?: string },
];

const rows: Row[] = [
  ["nothing", () => {}, "kept", false],
  ["start()", port => port.start(), "gone", false],
  ["start() twice", port => (port.start(), port.start()), "gone", false],
  [
    "start() and removeEventListener() of a function that is no listener",
    port => (port.start(), port.removeEventListener("message", listener)),
    "gone",
    false,
  ],
  ["start() and unref()", port => (port.start(), port.unref()), "gone", false],
  ["start() and ref()", port => (port.start(), port.ref()), "gone", true],
  [
    "addEventListener() and removeEventListener()",
    port => (port.addEventListener("message", listener), port.removeEventListener("message", listener)),
    "kept",
    false,
  ],
  [
    "start(), addEventListener() and removeEventListener()",
    port => (port.start(), port.addEventListener("message", listener), port.removeEventListener("message", listener)),
    "kept",
    false,
  ],
  [
    "addEventListener(), removeEventListener() and start()",
    port => (port.addEventListener("message", listener), port.removeEventListener("message", listener), port.start()),
    "gone",
    false,
  ],
  ["on() and off()", port => (port.on("message", listener), port.off("message", listener)), "kept", false],
  [
    "on(), off() and start()",
    port => (port.on("message", listener), port.off("message", listener), port.start()),
    "gone",
    false,
  ],
  ["once() and off()", port => (port.once("message", listener), port.off("message", listener)), "kept", false],
  [
    "on(), off() and removeAllListeners('message')",
    port => (port.on("message", listener), port.off("message", listener), port.removeAllListeners("message")),
    "kept",
    false,
  ],
  [
    "on(), off() and removeAllListeners()",
    port => (port.on("message", listener), port.off("message", listener), port.removeAllListeners()),
    "kept",
    false,
  ],
  ["onmessage = a function, then null", port => ((port.onmessage = listener), (port.onmessage = null)), "kept", false],
  [
    "onmessage = a function, then null, then start()",
    port => ((port.onmessage = listener), (port.onmessage = null), port.start()),
    "gone",
    false,
  ],
  [
    "onmessage = a function, then null, then start(), then null",
    port => ((port.onmessage = listener), (port.onmessage = null), port.start(), (port.onmessage = null)),
    "gone",
    false,
  ],
  [
    "onmessage = a function, then an object that is no function",
    port => ((port.onmessage = listener), (port.onmessage = {})),
    "kept",
    false,
    objectListens,
  ],
  [
    "onmessage = a function, then null, then an object that is no function",
    port => ((port.onmessage = listener), (port.onmessage = null), (port.onmessage = {})),
    "kept",
    false,
    objectListens,
  ],
  [
    "onmessage = a function, then an object that is no function, then on() and off()",
    port => (
      (port.onmessage = listener),
      (port.onmessage = {}),
      port.on("message", listener),
      port.off("message", listener)
    ),
    "kept",
    false,
    objectListens,
  ],
  // A first value that is no function leaves node's wrapper listener counted: only
  // removeAllListeners() stops such a port again.
  ["a first onmessage = null", port => (port.onmessage = null), "gone", true, noRef],
  ["a first onmessage = undefined", port => (port.onmessage = undefined), "gone", true, noRef],
  ["a first onmessage = 42", port => (port.onmessage = 42), "gone", true, noRef],
  ["a first onmessage = {}", port => (port.onmessage = {}), "gone", true, noRef],
  [
    "a first onmessage = null, then on() and off()",
    port => ((port.onmessage = null), port.on("message", listener), port.off("message", listener)),
    "gone",
    true,
    noRef,
  ],
  [
    "a first onmessage = null, then a function, then null",
    port => ((port.onmessage = null), (port.onmessage = listener), (port.onmessage = null)),
    "gone",
    true,
    noRef,
  ],
  [
    "a first onmessage = {}, then a function, then null",
    port => ((port.onmessage = {}), (port.onmessage = listener), (port.onmessage = null)),
    "gone",
    true,
    noRef,
  ],
  [
    "on(), a first onmessage = null, then off()",
    port => (port.on("message", listener), (port.onmessage = null), port.off("message", listener)),
    "gone",
    true,
    noRef,
  ],
  [
    "a first onmessage = null, removeAllListeners('message'), on() and off()",
    port => (
      (port.onmessage = null),
      port.removeAllListeners("message"),
      port.on("message", listener),
      port.off("message", listener)
    ),
    "kept",
    false,
    wrapperStays,
  ],
  [
    "a first onmessage = null, removeAllListeners(), on() and off()",
    port => (
      (port.onmessage = null),
      port.removeAllListeners(),
      port.on("message", listener),
      port.off("message", listener)
    ),
    "kept",
    false,
    wrapperStays,
  ],
  // removeAllListeners() drops the listeners and leaves the port as it is: receiving.
  [
    "on() and removeAllListeners('message')",
    port => (port.on("message", listener), port.removeAllListeners("message")),
    "gone",
    true,
    noRef,
  ],
  [
    "on() and removeAllListeners()",
    port => (port.on("message", listener), port.removeAllListeners()),
    "gone",
    true,
    noRef,
  ],
  [
    "on(), removeAllListeners('message'), on() and off()",
    port => (
      port.on("message", listener),
      port.removeAllListeners("message"),
      port.on("message", listener),
      port.off("message", listener)
    ),
    "kept",
    false,
  ],
  // A listener that was not added starts nothing.
  [
    "addEventListener() with a signal that is already aborted",
    port => port.addEventListener("message", listener, { signal: aborted() }),
    "kept",
    false,
  ],
  [
    "addEventListener() with a signal that aborts",
    port => {
      const controller = new AbortController();
      port.addEventListener("message", listener, { signal: controller.signal });
      controller.abort();
    },
    "kept",
    false,
  ],
  ["a 'messageerror' listener", port => port.on("messageerror", listener), "kept", false],
  ["a 'close' listener", port => port.on("close", listener), "kept", false],
  ["ref()", port => port.ref(), "kept", true],
];

describe("one message for a port with no 'message' listener", () => {
  for (const [name, prepare, nodeMessage, , bun] of rows) {
    const message = (isBun && bun?.message) || nodeMessage;
    test(`after ${name} it is ${message}`, { todo: isBun && bun?.todo }, async () => {
      const { port1, port2 } = new MessageChannel();
      try {
        prepare(port2);
        port1.postMessage("m");
        await turns();
        assert.deepStrictEqual(receiveMessageOnPort(port2), message === "kept" ? { message: "m" } : undefined);
      } finally {
        port1.close();
        port2.close();
      }
    });
  }
});

describe("hasRef() of a port with no 'message' listener", () => {
  for (const [name, prepare, , nodeHasRef, bun] of rows) {
    const hasRef = isBun && bun?.hasRef !== undefined ? bun.hasRef : nodeHasRef;
    test(`after ${name} it is ${hasRef}`, () => {
      const { port1, port2 } = new MessageChannel();
      try {
        prepare(port2);
        assert.strictEqual(port2.hasRef(), hasRef);
      } finally {
        port1.close();
        port2.close();
      }
    });
  }
});

// The peer posts one message and closes. A port that is receiving hands the message to no
// listener and gets 'close'. For any other port the close waits behind the message.
describe("the peer's 'close' behind one unread message", () => {
  for (const [name, prepare, nodeMessage, , bun] of rows) {
    const message = (isBun && bun?.message) || nodeMessage;
    test(`after ${name} it ${message === "gone" ? "arrives" : "waits"}`, { todo: isBun && bun?.todo }, async () => {
      const { port1, port2 } = new MessageChannel();
      try {
        const seen: string[] = [];
        prepare(port2);
        port2.on("close", () => seen.push("close"));
        port1.postMessage("m");
        port1.close();
        await turns();
        assert.deepStrictEqual(seen, message === "gone" ? ["close"] : []);
      } finally {
        port2.close();
      }
    });
  }
});

describe("a port that is receiving with no 'message' listener", () => {
  test("does not grow its queue", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      port2.start();
      for (let i = 0; i < 200; i++) port1.postMessage(i);
      await turns();
      assert.strictEqual(receiveMessageOnPort(port2), undefined);
    } finally {
      port1.close();
      port2.close();
    }
  });

  test("does not keep a message for a listener that comes later", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: string[] = [];
    const closed = once(port2, "close");
    port2.start();
    port1.postMessage("a");
    await turns();
    port2.on("message", (message: string) => seen.push(message));
    port1.postMessage("b");
    port1.close();
    await closed;
    assert.deepStrictEqual(seen, ["b"]);
  });

  // The message serializes and then fails to deserialize: its DataView is in bounds only once
  // the getter before it has grown the buffer.
  test("hands a message that fails to deserialize to its 'messageerror' listeners", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      let errors = 0;
      port2.on("messageerror", () => errors++);
      port2.start();
      const buffer = new ArrayBuffer(8, { maxByteLength: 65536 });
      port1.postMessage({
        buffer,
        get grow() {
          buffer.resize(65536);
          return 1;
        },
        get view() {
          return new DataView(buffer, 4096, 16);
        },
      });
      await turns();
      assert.strictEqual(errors, 1);
    } finally {
      port1.close();
      port2.close();
    }
  });

  // The port that a message carries is gone with the message. Nothing here waits for a
  // collection: node never closes such a port, and bun closes it when it is collected.
  for (const [name, prepare] of [
    ["start()", (port: any) => port.start()],
    [
      "on() and removeAllListeners('message')",
      (port: any) => (port.on("message", listener), port.removeAllListeners()),
    ],
    ["a first onmessage = null", (port: any) => (port.onmessage = null)],
  ] as const) {
    test(`after ${name}, drops a message that carries a port`, async () => {
      const { port1, port2 } = new MessageChannel();
      const carried = new MessageChannel();
      try {
        prepare(port2);
        port1.postMessage({ port: carried.port2 }, [carried.port2]);
        await turns();
        assert.strictEqual(receiveMessageOnPort(port2), undefined);
      } finally {
        port1.close();
        port2.close();
        carried.port1.close();
      }
    });
  }

  test("is stopped by the handler that removes the last listener, and the rest waits", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      const seen: string[] = [];
      const first = (message: string) => {
        seen.push(message);
        port2.off("message", first);
      };
      port2.on("message", first);
      for (const message of ["a", "b", "c"]) port1.postMessage(message);
      await turns();
      assert.deepStrictEqual(seen, ["a"]);
      assert.deepStrictEqual(receiveMessageOnPort(port2), { message: "b" });
    } finally {
      port1.close();
      port2.close();
    }
  });

  for (const [name, leave] of [
    ["off() and start()", (port: any, first: (message: string) => void) => (port.off("message", first), port.start())],
    ["removeAllListeners('message')", (port: any) => port.removeAllListeners("message")],
  ] as const) {
    test(`loses the rest of a burst when its handler leaves it receiving with ${name}`, async () => {
      const { port1, port2 } = new MessageChannel();
      const seen: string[] = [];
      const first = (message: string) => {
        seen.push(message);
        leave(port2, first);
      };
      port2.on("close", () => seen.push("close"));
      port2.on("message", first);
      for (const message of ["a", "b", "c"]) port1.postMessage(message);
      port1.close();
      await turns();
      assert.deepStrictEqual(seen, ["a", "close"]);
      assert.strictEqual(receiveMessageOnPort(port2), undefined);
    });
  }
});

describe("a port that is not receiving", () => {
  // What stopped the port keeps the peer's close reaching it once nothing is queued ahead.
  for (const [name, prepare] of [
    ["on() and off()", (port: any) => (port.on("message", listener), port.off("message", listener))],
    [
      "start(), on() and off()",
      (port: any) => (port.start(), port.on("message", listener), port.off("message", listener)),
    ],
    ["onmessage = a function, then null", (port: any) => ((port.onmessage = listener), (port.onmessage = null))],
  ] as const) {
    test(`gets the peer's 'close' after ${name}, with nothing unread`, async () => {
      const { port1, port2 } = new MessageChannel();
      const closed = once(port2, "close");
      prepare(port2);
      await turns();
      port1.close();
      await closed;
    });
  }

  test("drops what it kept when start() comes, and then gets the peer's 'close'", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: string[] = [];
    port2.on("close", () => seen.push("close"));
    port1.postMessage("a");
    port1.postMessage("b");
    port1.close();
    await turns();
    assert.deepStrictEqual(seen, []);
    port2.start();
    await turns();
    assert.deepStrictEqual(seen, ["close"]);
    assert.strictEqual(receiveMessageOnPort(port2), undefined);
  });

  // The port a started port was transferred as is a new port: it is not receiving.
  test("is what a started port is transferred as", async () => {
    const { port1, port2 } = new MessageChannel();
    const carrier = new MessageChannel();
    try {
      port2.start();
      carrier.port1.postMessage(port2, [port2]);
      const [moved] = await once(carrier.port2, "message");
      port1.postMessage("m");
      await turns();
      assert.deepStrictEqual(receiveMessageOnPort(moved), { message: "m" });
      moved.close();
    } finally {
      port1.close();
      carrier.port1.close();
      carrier.port2.close();
    }
  });

  // The object that a port was before its transfer still takes listeners. Removing them must
  // not stop the port it was transferred as.
  for (const [name, poke] of [
    ["on() and off()", (old: any) => (old.on("message", listener), old.off("message", listener))],
    ["onmessage = a function, then null", (old: any) => ((old.onmessage = listener), (old.onmessage = null))],
  ] as const) {
    test(`is not what ${name} on its old object makes of a transferred port`, async () => {
      const { port1, port2 } = new MessageChannel();
      const carrier = new MessageChannel();
      try {
        carrier.port1.postMessage(port2, [port2]);
        const [moved] = await once(carrier.port2, "message");
        const seen: string[] = [];
        moved.on("message", (message: string) => seen.push(message));
        poke(port2);
        port1.postMessage("m");
        await turns();
        assert.deepStrictEqual(seen, ["m"]);
        moved.close();
      } finally {
        port1.close();
        carrier.port1.close();
        carrier.port2.close();
      }
    });
  }
});

// The peer closed behind an unread message, so a ref() is all that holds the loop.
describe("hasRef() of a port whose peer closed behind an unread message", () => {
  for (const [name, order, todo] of [
    ["start() and ref()", (port: any) => (port.start(), port.ref()), undefined],
    // Here ref() takes nothing for a port that does not receive, and start() does not ask again.
    [
      "ref() and start()",
      (port: any) => (port.ref(), port.start()),
      "start() does not give a ref() its keepalive back",
    ],
  ] as const) {
    test(`is true after ${name} until 'close'`, { todo: isBun && todo }, async () => {
      const { port1, port2 } = new MessageChannel();
      const closed = once(port2, "close");
      port1.postMessage("unread");
      port1.close();
      await turns();
      order(port2);
      assert.strictEqual(port2.hasRef(), true);
      await closed;
      assert.strictEqual(port2.hasRef(), false);
    });
  }
});
