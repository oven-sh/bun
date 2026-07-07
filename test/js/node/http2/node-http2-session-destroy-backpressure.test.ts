import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A ClientHttp2Stream whose upload is flow-control blocked (the peer withholds WINDOW_UPDATE)
// has a DATA frame queued in native with its Writable _write callback held. When
// session.destroy() tears the stream down, that callback must receive an error so the stream
// does not emit 'drain', and any subsequent write() must not report success. Previously the
// dropped frame's callback reported success, so 'drain' woke a backpressured producer and
// every later write() returned true (once the native handle was gone _write fell through to
// callback()), buffering the producer's entire source into a dead stream.
test("http2 client session.destroy() with a flow-control-blocked write does not emit 'drain' or accept further writes", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http2 = require("node:http2");
      const net = require("node:net");
      const frame = (t, fl, sid, p = Buffer.alloc(0)) => {
        const b = Buffer.alloc(9 + p.length);
        b.writeUIntBE(p.length, 0, 3);
        b[3] = t;
        b[4] = fl;
        b.writeUInt32BE(sid >>> 0, 5);
        p.copy(b, 9);
        return b;
      };
      const PREFACE = Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n");
      // A raw TCP peer that speaks just enough HTTP/2 to establish the connection and then
      // withholds WINDOW_UPDATE so the client's DATA stays flow-control blocked.
      const server = net.createServer(s => {
        let buf = Buffer.alloc(0);
        let seenPreface = false;
        s.on("error", () => {});
        s.on("data", d => {
          buf = Buffer.concat([buf, d]);
          if (!seenPreface) {
            if (buf.length < PREFACE.length) return;
            seenPreface = true;
            buf = buf.slice(PREFACE.length);
            s.write(frame(4, 0, 0));
          }
          while (buf.length >= 9) {
            const len = buf.readUIntBE(0, 3);
            if (buf.length < 9 + len) break;
            const t = buf[3];
            const fl = buf[4];
            const pay = buf.slice(9, 9 + len);
            buf = buf.slice(9 + len);
            if (t === 4 && (fl & 1) === 0) s.write(frame(4, 1, 0));
            else if (t === 6 && (fl & 1) === 0) s.write(frame(6, 1, 0, pay));
          }
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const session = http2.connect("http://127.0.0.1:" + server.address().port);
        session.on("error", () => {});
        session.once("remoteSettings", () => {
          const stream = session.request({ ":path": "/u", ":method": "POST" });
          stream.on("error", () => {});
          // One write larger than the 65535-byte initial window: the first 65535 bytes go out
          // immediately and the remainder is queued natively, holding the _write callback until
          // the peer reopens the window (which never happens here).
          let writeCbErrorCode = null;
          const backpressured = stream.write(Buffer.alloc(65535 + 32768, 0x41), err => {
            writeCbErrorCode = err ? err.code : "none";
          }) === false;
          let drainsAfterDestroy = 0;
          let writeOkAfterDestroy = 0;
          stream.once("drain", function onDrain() {
            drainsAfterDestroy++;
            // The canonical backpressured producer: on 'drain', keep writing until write()
            // returns false again. Budget capped so the broken case terminates.
            let budget = 32;
            while (budget-- > 0 && stream.write(Buffer.alloc(16384))) writeOkAfterDestroy++;
            stream.once("drain", onDrain);
          });
          // Destroy from outside the native dispatch that delivered remoteSettings so the
          // session's stream teardown runs its own dispatch (where the queued-frame callback
          // fires before the stream is destroyed).
          process.nextTick(() => {
            session.destroy();
            stream.once("close", () => {
              server.close();
              console.log(
                JSON.stringify({
                  backpressured,
                  drainsAfterDestroy,
                  writeOkAfterDestroy,
                  writeCbErrorCode,
                }),
              );
              process.exit(0);
            });
          });
        });
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    result: {
      backpressured: true,
      drainsAfterDestroy: 0,
      writeOkAfterDestroy: 0,
      writeCbErrorCode: expect.stringMatching(/^(ERR_HTTP2_INVALID_STREAM|ECANCELED|ERR_STREAM_DESTROYED)$/),
    },
    stderr: expect.anything(),
    exitCode: 0,
  });
});
