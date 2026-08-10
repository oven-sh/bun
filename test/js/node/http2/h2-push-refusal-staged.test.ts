import { expect, test } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

// Staged twin of h2-conformance's "DATA on a promised stream before its
// response HEADERS is refused, not delivered", which times out waiting for a
// frame on the darwin agents. This variant tapes the client session's events
// and every frame the raw server receives, and names the stage that stalled.
function frame(len: number, type: number, flags: number, id: number, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(9);
  h.writeUIntBE(len, 0, 3);
  h.writeUInt8(type, 3);
  h.writeUInt8(flags, 4);
  h.writeUInt32BE(id, 5);
  return Buffer.concat([h, payload]);
}
const TYPE_NAME: Record<number, string> = {
  0: "DATA",
  1: "HEADERS",
  3: "RST",
  4: "SETTINGS",
  5: "PUSH_PROMISE",
  6: "PING",
  7: "GOAWAY",
  8: "WINDOW_UPDATE",
};

test("DATA on a reserved push stream is refused with RST(STREAM_CLOSED) (event-taped)", async () => {
  const tape: string[] = [];
  const t = (name: string) => tape.push(name);
  const frames: Array<{ type: number; flags: number; id: number; payload: Buffer }> = [];
  let buf = Buffer.alloc(0);
  let sawPreface = false;
  const waiters: Array<{ pred: (f: (typeof frames)[0]) => boolean; resolve: (f: (typeof frames)[0]) => void }> = [];
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (!sawPreface && buf.length >= 24) {
      buf = buf.subarray(24);
      sawPreface = true;
      t("preface");
    }
    while (sawPreface && buf.length >= 9) {
      const len = buf.readUIntBE(0, 3);
      if (buf.length < 9 + len) break;
      const f = {
        type: buf.readUInt8(3),
        flags: buf.readUInt8(4),
        id: buf.readUInt32BE(5) & 0x7fffffff,
        payload: Buffer.from(buf.subarray(9, 9 + len)),
      };
      buf = buf.subarray(9 + len);
      frames.push(f);
      t(`recv:${TYPE_NAME[f.type] ?? f.type}#${f.id}`);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(f)) waiters.splice(i, 1)[0].resolve(f);
      }
    }
  };
  const waitFor = (pred: (f: (typeof frames)[0]) => boolean, name: string) => {
    const hit = frames.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise<(typeof frames)[0]>((resolve, reject) => {
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error(`stalled waiting for ${name}; tape: ${tape.join(" -> ")}`)), 8_000).unref();
    });
  };

  const rawSocket = Promise.withResolvers<net.Socket>();
  const server = net.createServer(socket => {
    socket.on("error", () => t("raw-socket-error"));
    socket.on("data", onData);
    rawSocket.resolve(socket);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  client.on("error", e => t(`session-error:${(e as any).code ?? (e as Error).message}`));
  client.on("close", () => t("session-close"));
  client.socket?.on?.("error", (e: any) => t(`socket-error:${e.code ?? e.message}`));
  client.socket?.on?.("close", () => t("socket-close"));
  const pushedData: Buffer[] = [];
  client.on("stream", pushed => {
    t("pushed-stream");
    pushed.on("error", () => t("pushed-error"));
    pushed.on("data", (d: Buffer) => pushedData.push(d));
  });
  try {
    const req = client.request({ ":path": "/" });
    req.on("error", () => t("req-error"));
    const socket = await rawSocket.promise;
    await waitFor(f => f.type === 1 && f.id === 1, "client HEADERS");
    socket.write(frame(0, 4, 0, 0));
    socket.write(frame(0, 4, 0x1, 0));
    // PUSH_PROMISE on stream 1 reserving stream 2: indexed :method/:scheme/:path
    // plus a literal :authority (0x01 = literal-without-indexing, name index 1).
    const authority = Buffer.from("localhost");
    const block = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, authority.length]), authority]);
    const promised = Buffer.alloc(4);
    promised.writeUInt32BE(2, 0);
    socket.write(frame(4 + block.length, 5, 0x4, 1, Buffer.concat([promised, block])));
    t("sent-push-promise");
    socket.write(frame(1, 0, 0, 2, Buffer.from("x")));
    t("sent-data-on-reserved");

    const rst = await waitFor(f => f.type === 3 && f.id === 2, "RST on stream 2");
    expect(rst.payload.readUInt32BE(0)).toBe(5 /* STREAM_CLOSED */);
    socket.write(frame(8, 6, 0, 0, Buffer.alloc(8)));
    await waitFor(f => f.type === 6 && (f.flags & 0x1) !== 0, "PING ACK");
    expect(Buffer.concat(pushedData).length).toBe(0);
  } finally {
    client.destroy();
    server.close();
  }
}, 30_000);
