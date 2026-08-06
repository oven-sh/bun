import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// InspectorDebuggerAgent::disable() used to call internalDisable() unconditionally, so a
// Debugger.disable on an already-disabled agent (or before any enable) re-ran
// m_debugger.setClient(nullptr) and tripped ASSERT(!!m_client != !!client) in
// JSC::Debugger::setClient. Frontends send Debugger.disable liberally on teardown, so this is
// an ordinary sequence. The assert is ASSERT_ENABLED-only, hence the skipIf.
test.skipIf(!isDebug && !isASAN)("Debugger.disable is idempotent and does not abort on asserts builds", async () => {
  await using child = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0", "-e", "setInterval(()=>{},1000)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderr = "";
  const decoder = new TextDecoder();
  const { promise: urlPromise, resolve: resolveUrl, reject: rejectUrl } = Promise.withResolvers<URL>();
  const stderrDrained = (async () => {
    for await (const chunk of child.stderr) {
      stderr += decoder.decode(chunk);
      const m = stderr.match(/ws:\/\/[^\s]+/);
      if (m) resolveUrl(new URL(m[0]));
    }
    rejectUrl(new Error("inspectee exited before printing inspector URL:\n" + stderr));
  })();

  const url = await urlPromise;
  const ws = new WebSocket(url);
  const replies: Record<number, unknown> = {};
  try {
    let nextId = 1;
    let failed: unknown;
    const pending = new Map<number, (x: unknown) => void>();
    const send = (method: string, params: object = {}) =>
      new Promise<unknown>(resolve => {
        if (failed) return resolve(failed);
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const fail = (r: unknown) => {
      failed ??= r;
      for (const p of pending.values()) p(r);
      pending.clear();
    };
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(String(ev.data));
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        replies[msg.id] = msg;
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    });
    ws.addEventListener("close", ({ code, reason }) => fail({ closed: { code, reason } }));
    ws.addEventListener("error", cause => fail({ error: String(cause) }));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
    });

    // Disable before any enable: m_enabled is false at startup, so the agent must early-return.
    await send("Debugger.disable");
    // Enable, disable, disable: the second disable must be a no-op, not a second setClient(nullptr).
    await send("Debugger.enable");
    await send("Debugger.disable");
    await send("Debugger.disable");
    // The agent must still be usable afterwards.
    await send("Debugger.enable");
    await send("Debugger.disable");
  } finally {
    ws.close();
    child.kill();
  }

  await Promise.all([child.exited, stderrDrained.catch(() => {})]);
  if (child.signalCode === "SIGABRT") {
    throw new Error(
      `inspectee aborted on Debugger.disable (replies=${JSON.stringify(replies)}):\n${stderr.slice(-2000)}`,
    );
  }
  expect(replies).toEqual({
    1: { id: 1, result: {} },
    2: { id: 2, result: {} },
    3: { id: 3, result: {} },
    4: { id: 4, result: {} },
    5: { id: 5, result: {} },
    6: { id: 6, result: {} },
  });
});
