// https://github.com/oven-sh/bun/issues/32548

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// This regression is a timing race: the busy loop must monopolize the JS thread
// before the queued Debugger.pause is dispatched. Slow debug builds reproduce it
// deterministically; optimized release builds routinely win the race and pause
// anyway, making a fail-before flaky there. (Release+ASAN additionally aborts on a
// pre-existing unchecked exception in WebKit's JSJavaScriptCallFrame::scopeChain
// when validateExceptionChecks is on, which a plain `debugger;` pause hits too and
// which is unrelated to this fix.) The fix is platform independent, so debug-only
// coverage is sufficient.
test.skipIf(!isDebug)("Debugger.pause interrupts a busy loop and reports call frames", async () => {
  using dir = tempDir("issue-32548", {
    "index.js": `
        let counter = 0;
        console.log("busy-ready");
        while (true) {
          counter++;
          if (counter === Number.MAX_SAFE_INTEGER) console.log(counter);
        }
      `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-wait=ws://127.0.0.1:0/bun32548", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Parse the inspector URL from the banner on stderr, and separately watch
  // stdout for "busy-ready" so we know the loop is actually running before we
  // ask the debugger to pause.
  let stderrBuf = "";
  let stderrLineBuf = "";
  const { promise: urlPromise, resolve: urlResolve, reject: urlReject } = Promise.withResolvers<URL>();
  let urlFound = false;
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      const text = decoder.decode(chunk);
      stderrBuf += text;
      if (!urlFound) {
        stderrLineBuf += text;
        const lines = stderrLineBuf.split("\n");
        stderrLineBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const u = new URL(trimmed);
            if (u.protocol === "ws:" || u.protocol === "wss:") {
              urlFound = true;
              urlResolve(u);
              break;
            }
          } catch {}
        }
      }
    }
    if (!urlFound) {
      urlReject(new Error(`Inspector URL not found before child stderr closed: ${JSON.stringify(stderrBuf)}`));
    }
  })().catch(err => {
    if (!urlFound) urlReject(err);
  });

  let stdoutBuf = "";
  let busyReady = false;
  const { promise: busyPromise, resolve: busyResolve, reject: busyReject } = Promise.withResolvers<void>();
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      stdoutBuf += decoder.decode(chunk);
      if (!busyReady && stdoutBuf.includes("busy-ready")) {
        busyReady = true;
        busyResolve();
      }
    }
    if (!busyReady) {
      busyReject(new Error(`child stdout closed before "busy-ready": ${JSON.stringify(stdoutBuf)}`));
    }
  })().catch(err => {
    if (!busyReady) busyReject(err);
  });

  const url = await urlPromise;

  const ws = new WebSocket(url);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", e => reject(new Error("WebSocket error", { cause: e })), { once: true });
      ws.addEventListener("close", e => reject(new Error("WebSocket closed", { cause: e })), { once: true });
    });

    let nextId = 1;
    type Waiter = { resolve: (value: any) => void; reject: (error: Error) => void };
    const pending = new Map<number, Waiter>();
    const eventWaiters = new Map<string, Waiter>();
    let closeError: Error | undefined;

    const failAll = (error: Error) => {
      if (closeError) return;
      closeError = error;
      for (const w of pending.values()) w.reject(error);
      pending.clear();
      for (const w of eventWaiters.values()) w.reject(error);
      eventWaiters.clear();
    };
    ws.addEventListener("error", e => failAll(new Error("WebSocket error", { cause: e })));
    ws.addEventListener("close", e => failAll(new Error(`WebSocket closed (${e.code})`, { cause: e })));

    ws.addEventListener("message", ev => {
      const msg = JSON.parse(String(ev.data));
      if (typeof msg.id === "number") {
        const w = pending.get(msg.id);
        if (w) {
          pending.delete(msg.id);
          w.resolve(msg);
        }
      } else if (typeof msg.method === "string") {
        const w = eventWaiters.get(msg.method);
        if (w) {
          eventWaiters.delete(msg.method);
          w.resolve(msg.params);
        }
      }
    });

    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolve, reject) => {
        if (closeError) return reject(closeError);
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const waitForEvent = (method: string) =>
      new Promise<any>((resolve, reject) => {
        if (closeError) return reject(closeError);
        eventWaiters.set(method, { resolve, reject });
      });

    // Attach before any user code runs so the busy loop is compiled with
    // debug hooks (setBreakpointsActive / setPauseOnDebuggerStatements force
    // op_debug insertion), then release --inspect-wait so the loop starts.
    await Promise.all([
      send("Inspector.enable"),
      send("Runtime.enable"),
      send("Debugger.enable"),
      send("Debugger.setBreakpointsActive", { active: true }),
      send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
    ]);

    const pausedPromise = waitForEvent("Debugger.paused");
    send("Inspector.initialized").catch(() => {});

    // Only ask to pause once the loop is provably running. With the bug the
    // pause command is never even dispatched, so don't block on its response;
    // the Debugger.paused event below is the signal that matters.
    await busyPromise;
    send("Debugger.pause").catch(() => {});

    // With the bug, no Debugger.paused event ever arrives. Bound the wait so
    // the failure is a clear assertion, and clear the timer either way so no
    // stray timer/rejection outlives the test.
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    const paused = await Promise.race([
      pausedPromise,
      new Promise<never>((_, reject) => {
        pauseTimer = setTimeout(
          () =>
            reject(
              new Error("Debugger.pause produced no Debugger.paused event within 4s (busy loop was never interrupted)"),
            ),
          4000,
        );
      }),
    ]).finally(() => clearTimeout(pauseTimer));

    expect(Array.isArray(paused.callFrames)).toBe(true);
    expect(paused.callFrames.length).toBeGreaterThan(0);
    const top = paused.callFrames[0];
    expect(typeof top.functionName).toBe("string");
    expect(typeof top.location?.scriptId).toBe("string");
    expect(typeof top.location?.lineNumber).toBe("number");
  } catch (err) {
    const exitCode = proc.exitCode ?? proc.signalCode ?? "(running)";
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}\n` +
        `  child exit: ${exitCode}\n` +
        `  child stdout: ${JSON.stringify(stdoutBuf)}\n` +
        `  child stderr: ${JSON.stringify(stderrBuf)}`,
      { cause: err },
    );
  } finally {
    try {
      ws.close();
    } catch {}
    proc.kill();
    await proc.exited.catch(() => {});
  }
});
