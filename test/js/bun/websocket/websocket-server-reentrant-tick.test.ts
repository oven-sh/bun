import { expect, test } from "bun:test";
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
