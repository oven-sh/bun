// The debugger keeps the stack that scheduled a timer under a key made of the
// timer's id and kind, and shows it as the async stack trace when the callback
// runs. Timer ids are 64-bit. A key that keeps only 32 bits of the id gives a
// timer the async stack trace of the timer 2^32 ids later.
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function asyncStackTraceSchedulers() {
  using dir = tempDir("inspect-timer-async-stack", {
    "timers-fixture.js": `
      const { timerInternals } = require("bun:internal-for-testing");
      function scheduleEarlyTimeout() {
        return setTimeout(function earlyTimeoutCb() {
          debugger;
        }, 1);
      }
      function scheduleLateTimeout() {
        return setTimeout(function lateTimeoutCb() {}, 1);
      }
      function scheduleEarlyImmediate() {
        return setImmediate(function earlyImmediateCb() {
          debugger;
        });
      }
      function scheduleLateImmediate() {
        return setImmediate(function lateImmediateCb() {});
      }

      const early = [scheduleEarlyTimeout(), scheduleEarlyImmediate()].map(Number);
      timerInternals.setNextTimerId(2 ** 32 + early[0]);
      const late = [scheduleLateTimeout(), scheduleLateImmediate()].map(Number);
      console.log(JSON.stringify({ idDistances: late.map((id, i) => id - early[i]) }));
    `,
  });
  await using proc = spawn({
    cmd: [bunExe(), "--inspect-wait=ws://127.0.0.1:0/timer-async-stack", join(String(dir), "timers-fixture.js")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // The inspector prints its WebSocket URL on a line of stderr.
  const { promise: urlPromise, resolve: urlResolve, reject: urlReject } = Promise.withResolvers<string>();
  let stderrBuf = "";
  (async () => {
    const decoder = new TextDecoder();
    let found = false;
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      stderrBuf += decoder.decode(chunk, { stream: true });
      if (found) continue;
      const url = stderrBuf
        .split("\n")
        .slice(0, -1)
        .map(line => line.trim())
        .find(line => line.startsWith("ws://"));
      if (url) {
        found = true;
        urlResolve(url);
      }
    }
    if (!found) urlReject(new Error(`Inspector URL not found: ${JSON.stringify(stderrBuf)}`));
  })().catch(urlReject);
  const stdoutPromise = proc.stdout.text();

  const ws = new WebSocket(await urlPromise);
  try {
    // The name of each paused callback, and the function that its async stack trace names as the scheduler.
    const schedulers: Record<string, string | null> = {};
    const { promise: bothPaused, resolve: resolveBothPaused, reject: rejectBothPaused } = Promise.withResolvers<void>();
    let nextId = 1;
    const send = (method: string, params: Record<string, unknown> = {}) =>
      ws.send(JSON.stringify({ id: nextId++, method, params }));

    ws.addEventListener("error", () => rejectBothPaused(new Error(`WebSocket error; stderr=${stderrBuf}`)));
    ws.addEventListener("close", e => rejectBothPaused(new Error(`WebSocket closed (${e.code}); stderr=${stderrBuf}`)));
    ws.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.method !== "Debugger.paused") return;
      const { callFrames, asyncStackTrace } = message.params;
      // The first frame of the async stack trace is setTimeout or setImmediate. The second is its caller.
      schedulers[callFrames[0].functionName] = asyncStackTrace?.callFrames?.[1]?.functionName ?? null;
      send("Debugger.resume");
      if (Object.keys(schedulers).length === 2) resolveBothPaused();
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`WebSocket error; stderr=${stderrBuf}`)), { once: true });
    });

    send("Inspector.enable");
    send("Debugger.enable");
    send("Debugger.setBreakpointsActive", { active: true });
    send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
    send("Debugger.setAsyncStackTraceDepth", { depth: 8 });
    send("Inspector.initialized");

    await bothPaused;
    proc.kill();
    return { schedulers, ...JSON.parse(await stdoutPromise) };
  } finally {
    ws.close();
  }
}

// The timeout is for debug builds: there the inspected script takes about 4 s, most of it to
// load bun:internal-for-testing.
test("a timer callback gets its own async stack trace when another timer's id is 2^32 higher", async () => {
  expect(await asyncStackTraceSchedulers()).toEqual({
    schedulers: {
      earlyImmediateCb: "scheduleEarlyImmediate",
      earlyTimeoutCb: "scheduleEarlyTimeout",
    },
    idDistances: [2 ** 32, 2 ** 32],
  });
}, 30_000);
