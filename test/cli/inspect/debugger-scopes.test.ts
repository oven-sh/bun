// https://github.com/oven-sh/bun/issues/5958
//
// When paused inside an ES module's top level (`module code`), the scope chain
// should include the module's own let/const/var/function bindings. Previously
// JSModuleEnvironment only enumerated import entries and omitted its own
// symbol-table bindings, so the Inspector reported the module scope as
// `empty: true` and `Runtime.getDisplayableProperties` returned no locals.
// That meant VS Code's Variables pane was blank when stopped on a top-level
// `debugger;` statement.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

type Scope = {
  type: string;
  empty?: boolean;
  object: { objectId: string };
};

type InspectResult = {
  functionName: string;
  scopeChain: Scope[];
  scopeProperties: string[][];
};

async function inspectAtDebugger(files: Record<string, string>, entry: string): Promise<InspectResult> {
  using dir = tempDir("debugger-scopes", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-wait=ws://127.0.0.1:0/scopes", entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Drain stderr and extract the inspector WebSocket URL from the banner.
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
    if (!urlFound) urlReject(new Error(`inspector URL not found in stderr: ${JSON.stringify(stderrBuf)}`));
  })().catch(err => {
    if (!urlFound) urlReject(err);
  });

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
          if (msg.error) w.reject(new Error(JSON.stringify(msg.error)));
          else w.resolve(msg.result);
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
    const frame = paused.callFrames[0];
    const scopeChain: Scope[] = frame.scopeChain;

    const scopeProperties: string[][] = [];
    for (const scope of scopeChain) {
      // The global scope is very large and irrelevant here.
      if (scope.type === "global") {
        scopeProperties.push(["<global>"]);
        continue;
      }
      const { properties } = await send("Runtime.getDisplayableProperties", {
        objectId: scope.object.objectId,
      });
      scopeProperties.push((properties as Array<{ name: string }>).map(p => p.name).sort());
    }

    await send("Debugger.resume");

    // The debuggee keeps its event loop alive while the inspector connection
    // is open, so close before awaiting exit.
    ws.close();

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toContain("reached-end");
    expect(exitCode).toBe(0);

    return {
      functionName: frame.functionName,
      scopeChain,
      scopeProperties,
    };
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

describe("Debugger.paused module scope chain", () => {
  test("ESM top-level let/const/var/function appear in the module scope", async () => {
    const { functionName, scopeChain, scopeProperties } = await inspectAtDebugger(
      {
        "index.mjs": `
let a = 3;
const b = 4;
var c = 5;
function d() {}
debugger;
console.log("reached-end", a, b, c, d);
export {};
`,
      },
      "index.mjs",
    );

    expect(functionName).toBe("module code");

    // The first entry in the scope chain is the module environment. It must not
    // be reported as empty, and enumerating it must yield the module's own
    // bindings. Without the fix this scope arrives as { empty: true } with zero
    // properties.
    expect(scopeChain[0].type).toBe("closure");
    expect(scopeChain[0].empty).not.toBe(true);
    expect(scopeProperties[0]).toEqual(["a", "b", "c", "d"]);
  });

  test("ESM with named import shows both the import and local bindings", async () => {
    const { functionName, scopeChain, scopeProperties } = await inspectAtDebugger(
      {
        "dep.mjs": `export const imported = 42;\n`,
        "index.mjs": `
import { imported } from "./dep.mjs";
let localLet = 1;
const localConst = 2;
debugger;
console.log("reached-end", imported, localLet, localConst);
`,
      },
      "index.mjs",
    );

    expect(functionName).toBe("module code");
    expect(scopeChain[0].type).toBe("closure");
    expect(scopeChain[0].empty).not.toBe(true);
    // Previously only "imported" was listed; local bindings were missing.
    expect(scopeProperties[0]).toEqual(["imported", "localConst", "localLet"]);
  });

  test("CommonJS module wrapper scope chain still lists top-level bindings", async () => {
    const { functionName, scopeChain, scopeProperties } = await inspectAtDebugger(
      {
        "index.cjs": `
"use strict";
let a = 3;
var c = 5;
debugger;
console.log("reached-end", a, c, module.id);
`,
      },
      "index.cjs",
    );

    // CJS is executed inside Bun's (function (exports, require, module, ...) { ... })
    // wrapper, so the top frame is the anonymous wrapper function rather than
    // "module code".
    expect(functionName).not.toBe("module code");

    // The wrapper's lexical scope carries `a`; its var scope carries `c` and
    // the wrapper parameters.
    expect(scopeChain[0].type).toBe("closure");
    expect(scopeProperties[0]).toEqual(["a"]);

    expect(scopeChain[1].type).toBe("closure");
    expect(scopeProperties[1]).toEqual(
      expect.arrayContaining(["__dirname", "__filename", "c", "exports", "module", "require"]),
    );
  });
});
