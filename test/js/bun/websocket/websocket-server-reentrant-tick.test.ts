import { expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";
import { OP, RawClient } from "../../web/websocket/raw-peer";

// A message, ping or pong handler runs JS. When it returns, the microtask drain can resume a test
// body that then calls `expect(promise).rejects`, which ticks the event loop from inside the
// handler. That tick reads the next frame on the same socket through the same frame parser.
// The parser must be between frames when a handler runs, or the nested frame is misparsed:
// a new data frame used to fail as interleaved with the message still on the parser's stack.

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
        if (message === "second") second.reject(new Error("second"));
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

test("a nested tick after a message that ended in a continuation read reads the next frame", async () => {
  const got: string[] = [];
  const ready = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  using server = serve(
    {
      message(ws, message) {
        got.push(message.toString());
        if (message === "hello") ready.resolve();
        if (message === "second") second.reject(new Error("second"));
      },
    },
    ready,
    second,
  );
  using raw = await RawClient.upgrade(server.port);
  // Header, mask and one payload byte in the first read, the rest in a second read.
  await writeSplit(raw, raw.frame(OP.text, "hello"), 7);
  // Resumes inside the server's message handler for "hello".
  await ready.promise;
  raw.text("second");
  await expect(second.promise).rejects.toThrow("second");
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
