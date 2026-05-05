import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Regression test for a data race in MessageEvent between the mutator thread
// (initMessageEvent() reassigning m_data) and the GC marker thread
// (visitChildren → memoryCost() reading m_data via std::visit). The lock guard
// around m_data was written as `Locker { lock };`, a temporary that destructs
// immediately, so the critical section was never actually held. When m_data
// held a Ref<SerializedScriptValue> (e.g. a MessageEvent delivered through a
// BroadcastChannel) the GC visitor could observe a torn variant and crash with
// `ASSERTION FAILED: m_ptr` in Ref::operator-> (or a SIGSEGV in release).
test(
  "MessageEvent.initMessageEvent does not race GC visitor on m_data",
  async () => {
    const script = /* js */ `
    const bc1 = new BroadcastChannel("message-event-init-gc");
    const bc2 = new BroadcastChannel("message-event-init-gc");
    const received = [];
    bc2.onmessage = e => received.push(e);
    for (let i = 0; i < 100; i++) bc1.postMessage({ i });

    await new Promise(r => {
      const check = () => (received.length >= 100 ? r() : setTimeout(check, 1));
      check();
    });

    // Each received MessageEvent's m_data is a Ref<SerializedScriptValue>.
    // initMessageEvent() transitions it to JSValueTag while the concurrent
    // collector (enabled via BUN_JSC_collectContinuously) is visiting the
    // same object's memoryCost().
    for (let j = 0; j < 50000; j++) {
      for (const e of received) e.initMessageEvent("y", false, false, j);
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
  isDebug || isASAN ? 120_000 : 30_000,
);
