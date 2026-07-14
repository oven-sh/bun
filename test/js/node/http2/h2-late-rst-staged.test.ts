import { expect, test } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

// Staged twin of node-http2.test.js "client tolerates a late RST_STREAM for a
// stream it already closed and evicted", which fails intermittently on the
// darwin and windows-baseline agents with "session closed before the ping
// arrived" and no error event - an errorless destroy whose trigger the
// original test cannot name. This variant records every session/socket event
// in order and prints the tape on failure.
function frame(len: number, type: number, flags: number, id: number, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(9);
  h.writeUIntBE(len, 0, 3);
  h.writeUInt8(type, 3);
  h.writeUInt8(flags, 4);
  h.writeUInt32BE(id, 5);
  return Buffer.concat([h, payload]);
}
const settings = (ack: boolean) => frame(0, 4, ack ? 1 : 0, 0);
const rstFrame = (id: number, code: number) => {
  const p = Buffer.alloc(4);
  p.writeUInt32BE(code, 0);
  return frame(4, 3, 0, id, p);
};
const ping = () => frame(8, 6, 0, 0, Buffer.alloc(8, 7));

async function runLateRstStages(sendPing: boolean) {
  const tape: string[] = [];
  const t = (name: string) => tape.push(name);

  const rawSocket = Promise.withResolvers<net.Socket>();
  const server = net.createServer(socket => {
    socket.on("error", () => t("raw-socket-error"));
    socket.on("data", () => {});
    socket.write(settings(false));
    socket.write(settings(true));
    rawSocket.resolve(socket);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    for (const ev of ["connect", "close", "goaway", "frameError", "timeout"]) {
      client.on(ev, () => t(`session-${ev}`));
    }
    client.on("error", e => t(`session-error:${(e as any).code ?? (e as Error).message}`));
    client.socket?.on?.("close", () => t("socket-close"));
    client.socket?.on?.("error", (e: any) => t(`socket-error:${e.code ?? e.message}`));

    const req = client.request({ ":path": "/" });
    req.on("error", e => t(`req-error:${(e as any).code}`));
    const closed = new Promise<void>(resolve => req.on("close", () => (t("req-close"), resolve())));

    const socket = await rawSocket.promise;
    socket.write(rstFrame(1, http2.constants.NGHTTP2_CANCEL));
    await closed;
    t("evicted");

    const settled = new Promise<void>((resolve, reject) => {
      if (sendPing) {
        client.once("ping", () => (t("ping"), resolve()));
      } else {
        // No ping: the session merely has to survive the late RST. Bounded
        // poll instead of sleep-then-check: reject fast on close.
        setTimeout(() => (client.destroyed || client.closed ? undefined : resolve()), 1_000).unref();
      }
      client.once("close", () => reject(new Error(`session closed; tape: ${tape.join(" -> ")}`)));
      setTimeout(() => reject(new Error(`never settled; tape: ${tape.join(" -> ")}`)), 8_000).unref();
    });
    socket.write(rstFrame(1, http2.constants.NGHTTP2_NO_ERROR));
    t("late-rst-sent");
    if (sendPing) {
      socket.write(ping());
      t("ping-sent");
    }
    await settled;
    expect(client.destroyed).toBe(false);
    client.destroy();
  } finally {
    server.close();
  }
}

// The darwin tape (evicted -> socket-close, silent - no session error, no
// ping event) says the client transport closes while processing the late
// frames. These two subtests bisect which frame triggers it.
test("late RST_STREAM on an evicted stream is tolerated (no ping)", () => runLateRstStages(false), 30_000);
test("late RST_STREAM then PING is answered (event-taped)", () => runLateRstStages(true), 30_000);
