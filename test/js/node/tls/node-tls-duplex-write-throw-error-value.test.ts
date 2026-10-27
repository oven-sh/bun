// When a TLS connection is wrapped around a user-supplied Duplex transport and
// that Duplex's `write()` throws synchronously, the thrown value must reach the
// TLSSocket's `'error'` listener as a plain Error, not the engine-internal
// JSC::Exception wrapper cell. The wrapper cell has no prototype:
// `Object.prototype.toString.call` on it aborts the process, property loads on
// it trip a debug assertion inside `synthesizePrototype`, and the user's own
// error message is lost.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, tempDir } from "harness";

test("tls over Duplex: throwing transport write surfaces the thrown Error, not an engine-internal cell", async () => {
  using dir = tempDir("tls-duplex-throw", {
    "fixture.cjs": `
      const tls = require("node:tls");
      const { Duplex } = require("node:stream");
      const key = ${JSON.stringify(certs.key)};
      const cert = ${JSON.stringify(certs.cert)};

      let armed = false;
      let fired = 0;
      class Wire extends Duplex {
        _write(chunk, enc, cb) {
          if (armed && this.hook && fired++ === 0) throw new Error("boom-in-transport-_write");
          this.peer.push(Buffer.from(chunk));
          cb();
        }
        _read() {}
      }
      const c = new Wire();
      const s = new Wire();
      c.peer = s;
      s.peer = c;
      c.hook = true;

      process.on("uncaughtException", e => console.log("uncaught:" + (e && e.message)));

      const srv = new tls.TLSSocket(s, { isServer: true, key, cert });
      srv.on("error", () => {});
      srv.resume();

      const cli = tls.connect({ socket: c, rejectUnauthorized: false });
      cli.on("error", v => {
        // The crash under test fires on the first property load / toString of
        // the value: in debug builds even node:events' own \`err.code\` read
        // trips a JSC assertion before this listener runs at all.
        const tag = Object.prototype.toString.call(v);
        console.log("error:" + (v instanceof Error) + ":" + tag + ":" + (v && v.message));
      });
      cli.on("secureConnect", () => {
        armed = true;
        cli.write(Buffer.alloc(64 * 1024, 0x41));
        setImmediate(() => setImmediate(() => process.exit(0)));
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.cjs"],
    env: { ...bunEnv, ASAN_OPTIONS: "symbolize=0:abort_on_error=1:allow_user_segv_handler=1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The server side sees the truncated handshake bytes and may report its own
  // protocol error as an uncaughtException; the assertion below only cares
  // that the client's `'error'` listener received the user's thrown Error.
  const lines = stdout.trim().split(/\r?\n/);
  expect({ lines, stderr, exitCode }).toEqual({
    lines: expect.arrayContaining(["error:true:[object Error]:boom-in-transport-_write"]),
    stderr: "",
    exitCode: 0,
  });
});
