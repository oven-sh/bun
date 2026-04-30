// After the TLS-over-Duplex close path frees the socket's Handlers allocation
// (TLSSocket.onClose → markInactive → Handlers.markInactive → destroy), the
// UpgradedDuplex layer calls duplex.end() to shut the underlying stream. If
// that JS call throws, the error used to be routed back into
// tls.handleError → getHandlers(), which dereferenced the just-freed Handlers
// pointer (ASAN: heap-use-after-free). DuplexUpgradeContext.onClose now nulls
// its `tls` reference so onError bails early instead.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// The freed pointer is only reliably caught under ASAN (which the debug build
// enables); release builds may read garbage without trapping.
test.skipIf(!isASAN && !isDebug)(
  "tls.connect({socket: Duplex}) does not read freed Handlers when duplex.end() throws after close",
  async () => {
    // Spawn a subprocess so an ASAN heap-use-after-free report translates into
    // a non-zero exit rather than killing the test runner itself.
    const script = `
    const tls = require("node:tls");
    const { Duplex } = require("node:stream");

    // Minimal duplex: write/read are no-ops. The only thing that matters is
    // that end() throws synchronously — UpgradedDuplex.callWriteOrEnd catches
    // that and routes it through onError.
    const duplex = new Duplex({
      read() {},
      write(chunk, enc, cb) { cb(); },
      final(cb) { cb(); },
    });
    duplex.end = function () {
      throw new Error("end() throws during close");
    };

    const sock = tls.connect({
      socket: duplex,
      rejectUnauthorized: false,
    });
    sock.on("error", () => {});
    sock.on("close", () => {});

    // startTLS runs on the next tick; once onOpen has fired (is_open=true),
    // emitting "close" on the duplex triggers the SSL wrapper's fast
    // shutdown → UpgradedDuplex.onClose → DuplexUpgradeContext.onClose →
    // TLSSocket.onClose (frees handlers) → callWriteOrEnd → duplex.end()
    // throws → onError.
    setImmediate(() => {
      setImmediate(() => {
        duplex.emit("close");
        setImmediate(() => {
          console.log("ok");
          process.exit(0);
        });
      });
    });
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      // Disable the external ASAN symbolizer: when the UAF fires it can
      // wedge on a broken pipe to llvm-symbolizer and the subprocess never
      // exits, turning a clear assertion failure into a test timeout.
      env: { ...bunEnv, ASAN_OPTIONS: "symbolize=0:abort_on_error=1:allow_user_segv_handler=1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On failure stderr carries the ASAN "use-after-poison" report; include
    // it in the assertion so the diff shows the crash rather than just an
    // empty stdout.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  },
);
