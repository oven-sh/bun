// DuplexUpgradeContext holds a TLSSocket whose Handlers allocation is freed
// (via Handlers.markInactive → vm.allocator.destroy) the first time
// active_connections hits 0. Several callbacks in DuplexUpgradeContext kept
// dispatching into the TLSSocket after that point, reading tls.handlers on
// freed memory. Each case below used to abort under ASAN; the fix nulls
// `this.tls` before the freeing call so subsequent callbacks short-circuit
// on the existing null-check.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

async function run(script: string) {
  // Spawn a subprocess so an ASAN use-after-poison report shows up as a
  // non-zero exit + stderr dump rather than killing the test runner itself.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    // Disable the external ASAN symbolizer: when the UAF fires it can wedge
    // on a broken pipe to llvm-symbolizer and the subprocess never exits,
    // turning a clear assertion failure into a test timeout.
    env: { ...bunEnv, ASAN_OPTIONS: "symbolize=0:abort_on_error=1:allow_user_segv_handler=1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // On failure stderr carries the ASAN "use-after-poison" report; include
  // it in the assertion so the diff shows the crash rather than just an
  // empty stdout.
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
}

// The freed pointer is only reliably caught under ASAN (which the debug
// build enables); release builds may read garbage without trapping. Each
// test spawns an independent subprocess so they can run concurrently.
describe.concurrent.skipIf(!isASAN && !isDebug)("tls.connect({socket: Duplex}) does not read freed Handlers", () => {
  test("when duplex.end() throws after close", async () => {
    // UpgradedDuplex.onClose → DuplexUpgradeContext.onClose → TLSSocket.onClose
    // frees the Handlers; UpgradedDuplex.onClose then calls duplex.end(). If
    // that throws, onError → tls.handleError → getHandlers() read the freed
    // allocation.
    await run(`
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
    `);
  });

  test("when SSL context creation fails", async () => {
    // DuplexUpgradeContext.runEvent's .StartTLS error branch used to call
    // tls.handleConnectError() — which frees the Handlers via markInactive —
    // immediately followed by tls.onClose(), which read handlers.mode on the
    // freed allocation.
    await run(`
      const tls = require("node:tls");
      const { Duplex } = require("node:stream");

      const duplex = new Duplex({
        read() {},
        write(chunk, enc, cb) { cb(); },
        final(cb) { cb(); },
      });

      // A non-PEM string makes createSSLContext() return null →
      // error.InvalidOptions → runEvent's StartTLS catch → else branch.
      const sock = tls.connect({
        socket: duplex,
        ca: "not a valid PEM certificate",
        rejectUnauthorized: false,
      });
      sock.on("error", () => {});
      sock.on("close", () => {});

      setImmediate(() => {
        setImmediate(() => {
          console.log("ok");
          process.exit(0);
        });
      });
    `);
  });

  test("when a pre-open duplex error races StartTLS", async () => {
    // An error on the duplex before the queued .StartTLS task runs
    // (is_open == false) routed to DuplexUpgradeContext.onError →
    // tls.handleConnectError(), freeing the Handlers. The .StartTLS task
    // then fired onOpen → tls.onOpen → isServer() → getHandlers() on the
    // freed allocation.
    await run(`
      const tls = require("node:tls");
      const { Duplex } = require("node:stream");

      const duplex = new Duplex({
        read() {},
        write(chunk, enc, cb) { cb(); },
        final(cb) { cb(); },
      });

      const sock = tls.connect({
        socket: duplex,
        rejectUnauthorized: false,
      });
      sock.on("error", () => {});
      sock.on("close", () => {});

      // Non-Buffer data triggers UpgradedDuplex.onReceivedData's error branch
      // → DuplexUpgradeContext.onError with is_open == false, before the
      // queued .StartTLS task has run.
      queueMicrotask(() => {
        duplex.emit("data", "string, not a buffer");
      });

      setImmediate(() => {
        setImmediate(() => {
          console.log("ok");
          process.exit(0);
        });
      });
    `);
  });
});
