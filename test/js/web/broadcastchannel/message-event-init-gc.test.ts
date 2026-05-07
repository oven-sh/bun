import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";

// Regression test for a data race in MessageEvent between the mutator thread
// (initMessageEvent() reassigning m_data) and the GC marker thread
// (visitChildren → memoryCost() reading m_data via std::visit). The lock guard
// around m_data was written as `Locker { lock };`, a temporary that destructs
// immediately, so the critical section was never actually held. When m_data
// held a Ref<SerializedScriptValue> (a MessageEvent delivered through a
// BroadcastChannel) the GC visitor could observe a torn variant — ~Ref()
// nulls m_ptr before the variant index is updated — and crash with
// `ASSERTION FAILED: m_ptr` in Ref::operator-> (SIGSEGV in release).
//
// The race window is the few instructions between ~Ref()'s
// exchange(m_ptr, nullptr) and the variant index write, so we need many
// fresh Ref→JSValueTag transitions under concurrent marking to hit it. We
// accumulate every received event in `all` so each GC cycle has progressively
// more memoryCost() visits, and each round supplies a fresh batch whose
// initMessageEvent() call performs the racy variant reassignment.
//
// collectContinuously is prohibitively slow on Windows CI; the m_data race is
// platform-agnostic C++ so POSIX coverage is sufficient.
test.skipIf(isWindows)(
  "MessageEvent.initMessageEvent does not race GC visitor on m_data",
  async () => {
    const script = /* js */ `
    const bc1 = new BroadcastChannel("message-event-init-gc");
    const bc2 = new BroadcastChannel("message-event-init-gc");
    const all = [];
    let fresh = [];
    let want = 0;
    let resolver = null;
    bc2.onmessage = e => {
      fresh.push(e);
      all.push(e);
      if (resolver && all.length >= want) {
        const r = resolver;
        resolver = null;
        r();
      }
    };
    const N = 100;
    const ROUNDS = 100;
    for (let round = 0; round < ROUNDS; round++) {
      fresh = [];
      want = all.length + N;
      const delivered = new Promise(r => (resolver = r));
      for (let i = 0; i < N; i++) bc1.postMessage({ big: new ArrayBuffer(1024 * 64), i });
      await delivered;
      // Each fresh event's m_data is a Ref<SerializedScriptValue>; this
      // reassigns it to JSValueTag while the concurrent collector may be
      // inside memoryCost() on the same event.
      for (const e of fresh) e.initMessageEvent("y", false, false, 0);
    }
    bc1.close();
    bc2.close();
    console.log("OK");
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const filteredStderr = stderr
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
      .join("\n");

    expect(filteredStderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  isDebug || isASAN ? 300_000 : 60_000,
);
