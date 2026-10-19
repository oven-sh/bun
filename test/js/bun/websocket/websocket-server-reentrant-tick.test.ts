import { expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";
import { OP, RawClient, showFrame } from "../../web/websocket/raw-peer";

// A message, ping or pong handler runs JS. When it returns, the microtask drain can resume a test
// body that then calls `expect(promise).rejects`, which ticks the event loop from inside the
// handler. That tick reads the next frame on the same socket through the same frame parser.
// The parser must be between frames when a handler runs, or the nested frame is misparsed:
// a new data frame used to fail as interleaved with the message still on the parser's stack.

test("a nested tick inside the message handler reads the next frame (#45805)", async () => {
  const ready = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
    },
    websocket: {
      message(ws, message) {
        ws.send(message);
        if (message.toString() === "ready") ready.resolve();
      },
    },
  });
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
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
    },
    websocket: {
      message(ws, message) {
        got.push(message.toString());
        if (message === "hello") ready.resolve();
        if (message === "second") second.reject(new Error("second"));
      },
      close(ws, code, reason) {
        second.reject(new Error(`${code}: ${reason}`));
      },
    },
  });
  using raw = await RawClient.upgrade(server.port);
  raw.text("hel", { fin: false });
  raw.send(OP.continuation, "lo");
  // Resumes inside the server's message handler for "hello", whose bytes sit in the fragment buffer.
  await ready.promise;
  raw.text("second");
  await expect(second.promise).rejects.toThrow("second");
  expect(got).toEqual(["hello", "second"]);
});

test("a nested tick inside the ping handler reads the rest of a fragmented message", async () => {
  const got: string[] = [];
  const pinged = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
    },
    websocket: {
      message(ws, message) {
        got.push(message.toString());
        ws.send(message);
      },
      ping() {
        pinged.resolve();
      },
    },
  });
  using raw = await RawClient.upgrade(server.port);
  // The first frame a handler can act on is the text frame the server echoes. A pong other than
  // the automatic reply to the ping below means the continuation was taken for a control frame.
  const reply = (async () => {
    for (;;) {
      const frame = await raw.nextFrame();
      if (!frame) throw new Error("EOF");
      if (frame.opcode === OP.pong && frame.payload.toString() === "p") continue;
      throw new Error(showFrame(frame));
    }
  })();
  raw.text("hel", { fin: false });
  raw.ping("p");
  // Resumes inside the server's ping handler, with the text message still open.
  await pinged.promise;
  raw.send(OP.continuation, "lo");
  await expect(reply).rejects.toThrow('text "hello"');
  expect(got).toEqual(["hello"]);
});

function serve(websocket: Bun.WebSocketHandler<undefined>) {
  return Bun.serve({
    port: 0,
    fetch(req, server) {
      return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
    },
    websocket,
  });
}

// Ends a write `head` bytes into `frame`. The ping in front is answered in the same parse pass, so
// its pong proves the server consumed those bytes before the rest is sent.
async function writeSplit(raw: RawClient, frame: Buffer, head: number) {
  raw.write(Buffer.concat([raw.frame(OP.ping, "sync"), frame.subarray(0, head)]));
  expect(await raw.next()).toBe('pong "sync"');
  raw.write(frame.subarray(head));
}

test("a nested tick after a message that ended in a continuation read reads the next frame", async () => {
  const got: string[] = [];
  const ready = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  using server = serve({
    message(ws, message) {
      got.push(message.toString());
      if (message === "hello") ready.resolve();
      if (message === "second") second.reject(new Error("second"));
    },
    close(ws, code, reason) {
      second.reject(new Error(`${code}: ${reason}`));
    },
  });
  using raw = await RawClient.upgrade(server.port);
  // Header, mask and one payload byte in the first read, the rest in a second read.
  await writeSplit(raw, raw.frame(OP.text, "hello"), 7);
  // Resumes inside the server's message handler for "hello".
  await ready.promise;
  raw.text("second");
  await expect(second.promise).rejects.toThrow("second");
  expect(got).toEqual(["hello", "second"]);
});

test("a nested tick inside the handler of a ping read in two parts reads the rest of a fragmented message", async () => {
  const got: string[] = [];
  const pings: string[] = [];
  const pinged = Promise.withResolvers<void>();
  using server = serve({
    message(ws, message) {
      got.push(message.toString());
      ws.send(message);
    },
    ping(ws, data) {
      pings.push(data.toString());
      if (data.toString() === "pqr") pinged.resolve();
    },
  });
  using raw = await RawClient.upgrade(server.port);
  raw.text("hel", { fin: false });
  await writeSplit(raw, raw.frame(OP.ping, "pqr"), 7);
  // Resumes inside the server's ping handler, with the text message still open.
  await pinged.promise;
  const reply = (async () => {
    const frames: string[] = [];
    for (;;) {
      const frame = await raw.nextFrame();
      if (!frame) throw new Error("EOF after " + frames.join(", "));
      frames.push(showFrame(frame));
      if (frame.opcode === OP.text) throw new Error(frames.join(", "));
    }
  })();
  raw.send(OP.continuation, "lo");
  await expect(reply).rejects.toThrow('pong "pqr", text "hello"');
  expect(got).toEqual(["hello"]);
  expect(pings).toEqual(["sync", "pqr"]);
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
  using server = serve({
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
    close(ws, code, reason) {
      finished.reject(new Error(`${code}: ${reason}`));
    },
  });
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
