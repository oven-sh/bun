// `bun test --isolate` (and `bun build --compile` output) hands JSC a
// SourceProvider tagged BunTranspiledModule instead of Module so Bun's
// pre-computed module record is reused. That tag must behave like Module at
// every `sourceType()` switch in JSC's debugger/inspector; when it falls
// through, `Debugger.scriptParsed` reports `module: false` and
// `Debugger.setBreakpoint` replies "Could not resolve breakpoint".
// See oven-sh/WebKit#345.
//
// Kept in its own file (rather than inspect.test.ts) because inspect.test.ts
// is `[ASAN] [TIMEOUT]` in test/expectations.txt and several of its
// `localhost`-based websocket cases are environment-sensitive; this file runs
// clean on its own.
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function runDebuggerProbe(extraArgs: readonly string[], expectedSourceType: string | null) {
  using dir = tempDir("inspect-buntranspiledmodule", {
    "mod.test.ts": `import { test, expect } from "bun:test";
import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";
export const x = 1;
globalThis.__providerSourceType = isolatedModuleCacheSourceType(import.meta.path);
debugger;
test("t", () => { expect(x).toBe(1); });
`,
  });

  await using proc = spawn({
    cmd: [
      bunExe(),
      "--inspect-wait=ws://127.0.0.1:0/buntranspiledmodule",
      "test",
      ...extraArgs,
      join(String(dir), "mod.test.ts"),
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Scan complete stderr lines for the inspector WebSocket URL while draining
  // the stream so the child never back-pressures.
  let stderrBuf = "";
  let stderrLineBuf = "";
  const { promise: urlPromise, resolve: urlResolve, reject: urlReject } = Promise.withResolvers<URL>();
  let urlFound = false;
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      const text = decoder.decode(chunk);
      stderrBuf += text;
      if (urlFound) continue;
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
    if (!urlFound) urlReject(new Error(`Inspector URL not found: ${JSON.stringify(stderrBuf)}`));
  })().catch(err => {
    if (!urlFound) urlReject(err);
  });
  (async () => {
    for await (const _ of proc.stdout as ReadableStream<Uint8Array>) {
    }
  })().catch(() => {});

  const url = await urlPromise;
  const ws = new WebSocket(url);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", e => reject(new Error("WebSocket error", { cause: e })), { once: true });
      ws.addEventListener("close", e => reject(new Error("WebSocket closed", { cause: e })), { once: true });
    });

    type Waiter = { resolve: (value: any) => void; reject: (error: Error) => void };
    let nextId = 1;
    const pending = new Map<number, Waiter>();
    const eventWaiters = new Map<string, Waiter>();
    let closeError: Error | undefined;
    let userScript: { scriptId: string; module: boolean; url: string } | undefined;

    const failAll = (err: Error) => {
      if (closeError) return;
      closeError = err;
      for (const w of pending.values()) w.reject(err);
      pending.clear();
      for (const w of eventWaiters.values()) w.reject(err);
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
        if (msg.method === "Debugger.scriptParsed") {
          const p = msg.params;
          if (String(p.url).endsWith("mod.test.ts") || String(p.sourceURL).endsWith("mod.test.ts")) {
            userScript = { scriptId: String(p.scriptId), module: p.module === true, url: String(p.url) };
          }
        }
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

    await Promise.all([
      send("Inspector.enable"),
      send("Debugger.enable"),
      send("Debugger.setBreakpointsActive", { active: true }),
      send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
    ]);

    const pausedPromise = waitForEvent("Debugger.paused");
    send("Inspector.initialized").catch(() => {});
    const paused = await pausedPromise;
    expect(paused.reason).toBe("DebuggerStatement");

    if (!userScript) {
      throw new Error(`No Debugger.scriptParsed for mod.test.ts; stderr=${JSON.stringify(stderrBuf)}`);
    }

    // Self-check the premise: the --isolate run must actually be exercising a
    // BunTranspiledModule provider. Without this, a refactor that stops
    // attaching module_info to the entrypoint would leave both cases as
    // Module-vs-Module and the regression guard would evaporate. The fixture
    // stashed the value on globalThis because evaluateOnCallFrame parses its
    // expression as a Program (no `import.meta`) and module scope has no
    // `require`.
    const sourceTypeEval = await send("Debugger.evaluateOnCallFrame", {
      callFrameId: paused.callFrames?.[0]?.callFrameId,
      expression: `globalThis.__providerSourceType`,
      returnByValue: true,
    });

    const setBreakpoint = await send("Debugger.setBreakpoint", {
      location: { scriptId: userScript.scriptId, lineNumber: 5, columnNumber: 0 },
    });
    // Assert the inspector-visible shape (breakpoint + module flag + the
    // provider-type self-check) together so a failure shows the full picture.
    expect({
      providerSourceType: sourceTypeEval?.result?.result?.value ?? null,
      setBreakpoint,
      scriptParsedModule: userScript.module,
    }).toEqual({
      providerSourceType: expectedSourceType,
      setBreakpoint: {
        id: expect.any(Number),
        result: {
          breakpointId: expect.any(String),
          actualLocation: {
            scriptId: userScript.scriptId,
            lineNumber: 5,
            columnNumber: expect.any(Number),
          },
        },
      },
      scriptParsedModule: true,
    });

    // Use the URL the inspector reported (bun realpaths the script path before
    // reporting it) and a different line so the scriptId breakpoint above
    // doesn't collide.
    const setBreakpointByUrl = await send("Debugger.setBreakpointByUrl", {
      url: userScript.url,
      lineNumber: 2,
      columnNumber: 0,
    });
    expect(setBreakpointByUrl?.result?.locations).toEqual([
      { scriptId: userScript.scriptId, lineNumber: 2, columnNumber: expect.any(Number) },
    ]);

    await send("Debugger.resume").catch(() => {});
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

test.concurrent("bun test --isolate: Debugger.scriptParsed reports module and breakpoints resolve", async () => {
  await runDebuggerProbe(["--isolate"], "BunTranspiledModule");
});

// Sanity: without --isolate the provider is plain Module, the isolation cache
// is empty (hence null), and this has always worked; pinning it alongside
// ensures the --isolate case is being compared against the correct baseline.
test.concurrent("bun test (no --isolate): Debugger.scriptParsed reports module and breakpoints resolve", async () => {
  await runDebuggerProbe([], null);
});
