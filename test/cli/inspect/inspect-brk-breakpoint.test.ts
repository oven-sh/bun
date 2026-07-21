import { spawn } from "bun";
import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { WebSocket } from "ws";

// Spawn a program under --inspect-brk, set a breakpoint on `breakpointLine`
// (0-based), and evaluate `expression` on the top frame once paused. Returns the
// reported pause line and the evaluated value.
async function evaluateAtInspectBrkBreakpoint(program: string, breakpointLine: number, expression: string) {
  await using proc = spawn({
    // Bind an explicit IPv4 loopback so the URL we connect to cannot be steered
    // to ::1 by the system's localhost resolution.
    cmd: [bunExe(), "--inspect-brk=127.0.0.1:0", program],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // The inspector prints "ws://127.0.0.1:<port>/<uuid>" to stderr once it is
  // listening. Keep draining stderr so the child never blocks on a full pipe.
  const { promise: urlPromise, resolve: resolveUrl, reject: rejectUrl } = Promise.withResolvers<string>();
  let stderr = "";
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk as Uint8Array, { stream: true });
      const match = stderr.match(/ws:\/\/\S+/);
      if (match) resolveUrl(match[0]);
    }
    rejectUrl(new Error("inspector URL never printed; stderr:\n" + stderr));
  })();

  const url = await urlPromise;

  const ws = new WebSocket(url, { headers: { "Ref-Event-Loop": "0" } });
  try {
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const pausedResolvers = Promise.withResolvers<any>();
    ws.addEventListener("message", event => {
      const message = JSON.parse(
        typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"),
      );
      if (typeof message.id === "number") {
        const p = pending.get(message.id);
        if (p) {
          pending.delete(message.id);
          if (message.error) p.reject(new Error(message.error.message ?? "inspector error"));
          else p.resolve(message.result);
        }
      } else if (message.method === "Debugger.paused") {
        pausedResolvers.resolve(message.params);
      }
    });
    const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    };

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("inspector socket failed to open")), { once: true });
    });

    await send("Runtime.enable");
    await send("Debugger.enable");
    await send("Debugger.setBreakpointsActive", { active: true });
    await send("Debugger.setBreakpointByUrl", { url: program, lineNumber: breakpointLine, columnNumber: 0 });
    await send("Inspector.initialized");

    const paused = await Promise.race([
      pausedResolvers.promise,
      proc.exited.then(code => {
        throw new Error(`process exited (code ${code}) before the breakpoint was hit; stderr:\n${stderr}`);
      }),
    ]);

    const topFrame = paused.callFrames[0];
    const evaluated = await send("Debugger.evaluateOnCallFrame", {
      callFrameId: topFrame.callFrameId,
      expression,
      returnByValue: true,
    });
    return { pausedLineNumber: topFrame.location.lineNumber as number, value: evaluated.result.value };
  } finally {
    ws.close();
  }
}

// https://github.com/oven-sh/bun/issues/32591
// With --inspect-brk, Bun injects a `debugger;` statement to break on the first
// line. It used to be printed on its own line, which shifted every following
// statement down one line in the transpiled output. Because the inspector
// reports positions in transpiled-line space against the original file URL, a
// breakpoint requested on line N landed on line N-1, so the previous top-level
// lexical binding was still in its temporal dead zone when execution stopped.
test.concurrent("--inspect-brk breakpoint stops on the requested line, not the line before it (#32591)", async () => {
  using dir = tempDir("inspect-brk-line", {
    // Keep each statement on its own line; the breakpoint is set on the last one.
    "target.ts": [
      `const label = "bun-dap-repro";`,
      `const values = [2, 3, 5];`,
      `const total = values.reduce((sum, value) => sum + value, 0);`,
      `const payload = { label, values, total };`,
      "console.log(`${payload.label}:${payload.total}`);",
      "",
    ].join("\n"),
  });
  const program = fs.realpathSync(join(String(dir), "target.ts"));

  // Evaluate the lexical bindings declared above the breakpoint. When execution
  // really stopped on the console.log line, every `const` above it has been
  // initialized; the off-by-one stopped one line early and left `payload` in
  // its temporal dead zone.
  const { pausedLineNumber, value } = await evaluateAtInspectBrkBreakpoint(
    program,
    4, // 0-based line of `console.log(...)`
    `(() => ({
      total: (() => { try { return total; } catch { return "TDZ"; } })(),
      payloadTotal: (() => { try { return payload.total; } catch { return "TDZ"; } })(),
    }))()`,
  );

  expect(pausedLineNumber).toBe(4);
  expect(value).toEqual({ total: 10, payloadTotal: 10 });
});

// The injected `debugger;` must not leave a stale "previous statement" behind.
// An `export {}` clause prints a leading newline for readability when the
// previous statement is not export-like (the printer's SExportClause arm gates
// on `prev_stmt_tag.is_export_like()`). Without resetting the tag to SEmpty the
// clause would move to its own line and push every later statement down one,
// re-introducing the skew. (A leading class declaration hits the sibling
// `prev != SEmpty` path; it is not used here because a class body prints across
// multiple transpiled lines, which is a separate generated-vs-original line
// concern.)
test.concurrent("--inspect-brk keeps line numbers when the first statement is an export (#32591)", async () => {
  using dir = tempDir("inspect-brk-first-stmt", {
    "target.ts": [
      `export {};`, //                    line 0: prints a leading readability newline
      `const payload = { total: 10 };`, // line 1
      `console.log(payload.total);`, //    line 2: breakpoint target
      "",
    ].join("\n"),
  });
  const program = fs.realpathSync(join(String(dir), "target.ts"));

  const { pausedLineNumber, value } = await evaluateAtInspectBrkBreakpoint(
    program,
    2,
    `(() => { try { return payload.total; } catch { return "TDZ"; } })()`,
  );

  expect(pausedLineNumber).toBe(2);
  expect(value).toBe(10);
});
