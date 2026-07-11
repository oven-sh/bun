// Smoke tests for the code paths the WebKit 0e86b49069a5 upgrade touches on
// the Bun side. Each spawns a child so a compile-time or runtime abort in the
// touched path turns into an ordinary exitCode assertion instead of taking the
// test runner down with it.
//
// Fail-before note: with src/ reverted and scripts/build/deps/webkit.ts kept,
// the build itself fails (TicketData, resetIfNecessarySlow, isLocked no longer
// exist), so the gate's fail-before is a build failure rather than a test
// failure. Against the released Bun, the Temporal assertion is the one that
// fails.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// https://bugs.webkit.org/show_bug.cgi?id=318885: Temporal is on by default.
test("Temporal is a global object", async () => {
  const { stdout, stderr, exitCode } = await run(
    `if (typeof Temporal !== "object") throw new Error("Temporal is " + typeof Temporal);
     const instant = Temporal.Now.instant();
     if (!(instant instanceof Temporal.Instant)) throw new Error("not an Instant");
     process.stdout.write("ok");`,
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("ok");
  expect(exitCode).toBe(0);
});

// resetIfNecessarySlow() is gone; the upgrade rewrites the TZ setters to
// WTF::timeZoneDidChange() + DateCache::clearForTimeZoneChange(). This covers
// the ZigGlobalObject.cpp / JSEnvironmentVariableMap.cpp paths.
test("process.env.TZ invalidates the DateCache", async () => {
  const { stdout, stderr, exitCode } = await run(
    `process.env.TZ = "Etc/GMT-5";
     const h = new Date("2026-01-01T12:00:00Z").getHours();
     if (h !== 17) throw new Error("expected 17 got " + h);
     process.env.TZ = "UTC";
     const h2 = new Date("2026-01-01T12:00:00Z").getHours();
     if (h2 !== 12) throw new Error("expected 12 got " + h2);
     process.stdout.write("ok");`,
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("ok");
  expect(exitCode).toBe(0);
});

// DeferredWorkTimer::TicketData was renamed to Ticket and Task now takes
// Ticket&. JSCTaskScheduler::onAddPendingWork / onScheduleWorkSoon /
// onCancelPendingWork and runPendingWork were ported. FinalizationRegistry's
// cleanup callback is queued through exactly that path.
test("FinalizationRegistry cleanup runs through the DeferredWorkTimer hooks", async () => {
  const { stdout, stderr, exitCode } = await run(
    `const r = new FinalizationRegistry(v => {
       process.stdout.write(String(v));
       process.exit(0);
     });
     (function () { r.register({}, 42); })();
     for (let i = 0; i < 20; i++) { Bun.gc(true); await Bun.sleep(1); }
     // If we got here the callback never ran; still a clean exit so the
     // assertion below picks it up instead of the process hanging.
     process.stdout.write("no-callback");`,
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("42");
  expect(exitCode).toBe(0);
});

// ArrayBuffer::isLocked() is gone; SerializedScriptValue now checks
// !isDetachable() before transferring. WebAssembly.Memory's buffer is pinned,
// so transferring it must still throw, and a plain buffer must still transfer.
test("structuredClone transfer still rejects pinned buffers", async () => {
  const { stdout, stderr, exitCode } = await run(
    `const ab = new ArrayBuffer(8);
     const clone = structuredClone(ab, { transfer: [ab] });
     if (ab.byteLength !== 0) throw new Error("source not detached");
     if (clone.byteLength !== 8) throw new Error("clone not 8");
     const mem = new WebAssembly.Memory({ initial: 1 });
     let threw = false;
     try { structuredClone(mem.buffer, { transfer: [mem.buffer] }); }
     catch { threw = true; }
     if (!threw) throw new Error("wasm memory buffer should not be transferable");
     process.stdout.write("ok");`,
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("ok");
  expect(exitCode).toBe(0);
});
