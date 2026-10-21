import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocketServer } from "ws";
import { closePayload, OP, RawClient, showFullFrame } from "../../js/web/websocket/raw-peer";

// A message, ping or pong handler runs JS. When it returns, the microtask drain can resume a test
// body that then calls `expect(promise).rejects`, which ticks the event loop from inside the
// handler. That tick reads the next frame on the same socket through the same frame parser, so
// the parser must be between frames whenever a handler runs.

// A server that upgrades every request. A close rejects every promise in `pending`, so a test
// that waits on one fails with the close code instead of its timeout.
function serve(websocket: Bun.WebSocketHandler<undefined>, ...pending: PromiseWithResolvers<any>[]) {
  return Bun.serve({
    port: 0,
    fetch(req, server) {
      return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
    },
    websocket: {
      ...websocket,
      close(ws, code, reason) {
        for (const { reject } of pending) reject(new Error(`${code}: ${reason}`));
      },
    },
  });
}

// Ends a write `head` bytes into `frame`. The ping in front is answered in the same parse pass, so
// its pong proves the server consumed those bytes before the rest is sent.
async function writeSplit(raw: RawClient, frame: Buffer, head: number) {
  raw.write(Buffer.concat([raw.frame(OP.ping, "sync"), frame.subarray(0, head)]));
  expect(await raw.next()).toBe('pong "sync"');
  raw.write(frame.subarray(head));
}

// Rejects with the next `count` frames (`EOF` once the connection ends), so a `.rejects` matcher
// can wait for them and check them in one step.
async function nextFrames(raw: RawClient, count: number): Promise<never> {
  throw new Error((await raw.nextFrames(count)).join(", "));
}

test("a nested tick inside the message handler reads the next frame (#45805)", async () => {
  const ready = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<void>();
  using server = serve(
    {
      message(ws, message) {
        ws.send(message);
        if (message.toString() === "ready") ready.resolve();
      },
    },
    ready,
  );
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  ws.onopen = () => ws.send("ready");
  ws.onmessage = ({ data }) => {
    if (data === "denied") reply.reject(Object.assign(new Error("denied"), { code: "DENIED" }));
  };
  ws.onclose = ({ code, reason }) => reply.reject(new Error(`${code}: ${reason}`));
  try {
    // Resumes inside the server's message handler for "ready".
    await ready.promise;
    ws.send("denied");
    await expect(reply.promise).rejects.toMatchObject({ code: "DENIED" });
  } finally {
    ws.close();
  }
});

test("a nested tick after a fragmented message reads a new message on its own", async () => {
  const got: string[] = [];
  const ready = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  using server = serve(
    {
      message(ws, message) {
        got.push(message.toString());
        if (message === "hello") ready.resolve();
        else second.reject(new Error("second"));
      },
    },
    ready,
    second,
  );
  using raw = await RawClient.upgrade(server.port);
  raw.text("hel", { fin: false });
  raw.send(OP.continuation, "lo");
  // Resumes inside the server's message handler for "hello", whose bytes sit in the fragment buffer.
  await ready.promise;
  raw.text("second");
  await expect(second.promise).rejects.toThrow("second");
  expect(got).toEqual(["hello", "second"]);
});

test("a fragmented message started in a nested tick survives the return to the outer handler", async () => {
  const got: string[] = [];
  const ready = Promise.withResolvers<void>();
  const pinged = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  using server = serve(
    {
      message(ws, message) {
        got.push(message.toString());
        if (message === "hello") ready.resolve();
        else done.resolve();
      },
      ping() {
        pinged.reject(new Error("pinged"));
      },
    },
    ready,
    pinged,
    done,
  );
  using raw = await RawClient.upgrade(server.port);
  raw.text("hel", { fin: false });
  raw.send(OP.continuation, "lo");
  // Resumes inside the server's message handler for "hello".
  await ready.promise;
  raw.text("sec", { fin: false });
  raw.ping("p");
  await expect(pinged.promise).rejects.toThrow("pinged");
  // The handler for "hello" returns at the next await, with "sec" in the fragment buffer.
  raw.send(OP.continuation, "ond");
  await done.promise;
  expect(got).toEqual(["hello", "second"]);
});

test.each([
  ["header", 3],
  ["payload", 7],
])("a nested tick after a message split inside its %s reads the next one, split the same way", async (_, head) => {
  const got: string[] = [];
  const ready = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  using server = serve(
    {
      message(ws, message) {
        got.push(message.toString());
        if (message === "hello") ready.resolve();
        else second.reject(new Error("second"));
      },
    },
    ready,
    second,
  );
  using raw = await RawClient.upgrade(server.port);
  await writeSplit(raw, raw.frame(OP.text, "hello"), head);
  // Resumes inside the server's message handler for "hello".
  await ready.promise;
  // Both reads of "second" happen in the nested tick.
  const split = writeSplit(raw, raw.frame(OP.text, "second"), head);
  await expect(split.then(() => second.promise)).rejects.toThrow("second");
  expect(got).toEqual(["hello", "second"]);
  // The handler for "hello" has returned to the parser by the time this ping is read.
  raw.ping("alive");
  expect(await raw.next()).toBe('pong "alive"');
});

test.each([
  ["whole", 0],
  ["split inside its payload", 7],
])(
  "a nested tick that reads the socket closes it when a frame follows the %s message in the outer read",
  async (_, head) => {
    const got: string[] = [];
    const ready = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    using server = serve(
      {
        message(ws, message) {
          got.push(message.toString());
          if (message === "first") ready.resolve();
          else closed.reject(new Error(`read ${message}`));
        },
      },
      ready,
      closed,
    );
    using raw = await RawClient.upgrade(server.port);
    // One write, so that one read holds the end of "first" and all of "second".
    const frames = Buffer.concat([raw.frame(OP.text, "first"), raw.frame(OP.text, "second")]);
    if (head) await writeSplit(raw, frames, head);
    else raw.write(frames);
    // Resumes inside the server's message handler for "first". "second" is in the loop's only receive
    // buffer, which the read of "third" overwrites.
    await ready.promise;
    raw.text("third");
    await expect(closed.promise).rejects.toThrow(
      "1006: WebSocket handler ran the event loop with received frames left to parse",
    );
    expect(got).toEqual(["first"]);
    expect(showFullFrame((await raw.nextFrame())!)).toBe(
      'close 1011 "WebSocket handler ran the event loop with received frames left to parse"',
    );
  },
);

test("a `ws` server gets the same failure as an 'error' event", async () => {
  const events: unknown[] = [];
  const ready = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  try {
    wss.on("connection", ws => {
      ws.on("message", data => {
        events.push(String(data));
        if (String(data) === "first") ready.resolve();
      });
      ws.on("error", (error: NodeJS.ErrnoException) => events.push({ code: error.code, message: error.message }));
      ws.on("close", code => {
        events.push(code);
        ready.reject(new Error(`${code}`));
        closed.reject(new Error(`${code}`));
      });
    });
    await once(wss, "listening");
    using raw = await RawClient.upgrade((wss.address() as AddressInfo).port);
    raw.write(Buffer.concat([raw.frame(OP.text, "first"), raw.frame(OP.text, "second")]));
    // Resumes inside the 'message' listener for "first".
    await ready.promise;
    raw.text("third");
    raw.socket.end();
    await expect(closed.promise).rejects.toThrow("1006");
    expect(events).toEqual([
      "first",
      { code: "ERR_WEBSOCKET_NESTED_READ", message: "Listener ran the event loop with received frames left to parse" },
      1006,
    ]);
    expect(await raw.next()).toBe("close 1011");
  } finally {
    wss.close();
  }
});

test("a read that ends one split message and starts the next leaves the connection open", async () => {
  const got: string[] = [];
  const ready = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  using server = serve(
    {
      message(ws, message) {
        got.push(message.toString());
        if (message === "hello") ready.resolve();
        else done.resolve();
      },
    },
    ready,
    done,
  );
  using raw = await RawClient.upgrade(server.port);
  const hello = raw.frame(OP.text, "hello");
  const frames = Buffer.concat([hello, raw.frame(OP.text, "second")]);
  await writeSplit(raw, frames.subarray(0, hello.length + 7), 7);
  await ready.promise;
  raw.write(frames.subarray(hello.length + 7));
  await done.promise;
  expect(got).toEqual(["hello", "second"]);
});

test("a nested tick inside the ping handler reads the rest of a fragmented message", async () => {
  const got: string[] = [];
  const pinged = Promise.withResolvers<void>();
  using server = serve(
    {
      message(ws, message) {
        got.push(message.toString());
        ws.send(message);
      },
      ping() {
        pinged.resolve();
      },
    },
    pinged,
  );
  using raw = await RawClient.upgrade(server.port);
  raw.text("hel", { fin: false });
  raw.ping("p");
  // Resumes inside the server's ping handler, with the text message still open.
  await pinged.promise;
  // A pong other than the automatic reply to the ping means the continuation was taken for a
  // control frame.
  raw.send(OP.continuation, "lo");
  await expect(nextFrames(raw, 2)).rejects.toThrow('pong "p", text "hello"');
  expect(got).toEqual(["hello"]);
});

for (const [name, opcode, handler, echo] of [
  ["ping", OP.ping, "ping", ['pong "pqr"']],
  ["pong", OP.pong, "pong", []],
] as const) {
  test(`a nested tick inside the handler of a ${name} read in two parts reads the rest of a fragmented message`, async () => {
    const got: string[] = [];
    const control: string[] = [];
    const handled = Promise.withResolvers<void>();
    using server = serve(
      {
        message(ws, message) {
          got.push(message.toString());
          ws.send(message);
        },
        [handler](ws: unknown, data: Buffer) {
          control.push(data.toString());
          if (data.toString() === "pqr") handled.resolve();
        },
      },
      handled,
    );
    using raw = await RawClient.upgrade(server.port);
    raw.text("hel", { fin: false });
    await writeSplit(raw, raw.frame(opcode, "pqr"), 7);
    // Resumes inside the server's handler for the split control frame, with the text message
    // still open.
    await handled.promise;
    raw.send(OP.continuation, "lo");
    await expect(nextFrames(raw, echo.length + 1)).rejects.toThrow([...echo, 'text "hello"'].join(", "));
    expect(got).toEqual(["hello"]);
    expect(control).toEqual(name === "ping" ? ["sync", "pqr"] : ["pqr"]);
  });
}

test("a close frame read in two parts keeps its code and reason", async () => {
  const closed = Promise.withResolvers<void>();
  using server = serve({ message() {} }, closed);
  using raw = await RawClient.upgrade(server.port);
  await writeSplit(raw, raw.frame(OP.close, closePayload(1000, "bye")), 7);
  await expect(closed.promise).rejects.toThrow("1000: bye");
  expect(await raw.next()).toBe('close 1000 "bye"');
});

// The same re-entry without bun:test: a macro runs at transpile time, and the transpiler waits for
// its promise by ticking the event loop. The macro's promise settles once the server has handled
// the frame the nested tick reads.
test("a macro required inside the message handler reads the next frame", async () => {
  using dir = tempDir("ws-reentrant-macro", {
    "macro.ts": `export function value() { return globalThis.__wsReentrantTick; }`,
    "uses-macro.ts": `import { value } from "./macro.ts" with { type: "macro" };\nexport const v = value();`,
  });
  const order: string[] = [];
  const entered = Promise.withResolvers<void>();
  const done = Promise.withResolvers<string>();
  const finished = Promise.withResolvers<void>();
  (globalThis as any).__wsReentrantTick = done.promise;
  using server = serve(
    {
      message(ws, message) {
        order.push(`enter ${message}`);
        if (message === "hel") {
          entered.resolve();
          order.push(`macro ${require(path.join(String(dir), "uses-macro.ts")).v}`);
        }
        if (message === "lo") done.resolve("v");
        order.push(`exit ${message}`);
        if (message === "hel") finished.resolve();
      },
    },
    entered,
    done,
    finished,
  );
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  ws.onopen = () => ws.send("hel");
  try {
    // Resumes inside the transpiler's wait for the macro, under the handler for "hel".
    await entered.promise;
    ws.send("lo");
    await finished.promise;
    expect(order).toEqual(["enter hel", "enter lo", "exit lo", "macro v", "exit hel"]);
  } finally {
    delete (globalThis as any).__wsReentrantTick;
    ws.close();
  }
});
