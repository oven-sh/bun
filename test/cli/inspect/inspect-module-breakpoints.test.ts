// Runtime-transpiled ESM is handed to JSC as a SourceProvider tagged
// BunTranspiledModule (Bun's pre-computed module record replaces JSC's analyze
// pass). JSC's debugger has to treat that tag exactly like Module, otherwise
// `Debugger.setBreakpoint` on every user module replies "Could not resolve
// breakpoint" and `Debugger.setBreakpointByUrl` resolves to no locations.
// Requires the WebKit side of the fix (oven-sh/WebKit#405, merged as 723cea6c).
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--inspect: breakpoints resolve in a runtime-transpiled ES module", async () => {
  using dir = tempDir("inspect-module-breakpoints", {
    "mod.ts": [
      `export const x: number = 1;`,
      `const y = x + 1;`,
      `console.log(y);`,
      `setInterval(() => {}, 1000);`,
      ``,
    ].join("\n"),
  });

  await using proc = spawn({
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", "mod.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });

  let url: URL | undefined;
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
    stderr += decoder.decode(chunk, { stream: true });
    for (const line of stderr.split("\n")) {
      try {
        const candidate = new URL(line.trim());
        if (candidate.protocol === "ws:") {
          url = candidate;
          break;
        }
      } catch {}
    }
    if (url) break;
  }
  if (!url) throw new Error(`inspector URL not found in stderr: ${JSON.stringify(stderr)}`);

  const ws = new WebSocket(url);
  try {
    const failed = new Promise<never>((_, reject) => {
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
      ws.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
      proc.exited.then(code => reject(new Error(`inspectee exited early (${code})`)));
    });
    failed.catch(() => {});
    await Promise.race([new Promise<void>(resolve => ws.addEventListener("open", () => resolve())), failed]);

    const pending = new Map<number, (reply: any) => void>();
    const { promise: scriptParsed, resolve: resolveScriptParsed } = Promise.withResolvers<any>();
    ws.addEventListener("message", ({ data }) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === "number") {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      } else if (msg.method === "Debugger.scriptParsed" && String(msg.params?.url ?? "").endsWith("mod.ts")) {
        resolveScriptParsed(msg.params);
      }
    });
    let nextId = 0;
    const send = (method: string, params: Record<string, unknown> = {}) =>
      Promise.race([
        new Promise<any>(resolve => {
          const id = ++nextId;
          pending.set(id, resolve);
          ws.send(JSON.stringify({ id, method, params }));
        }),
        failed,
      ]);

    await Promise.all([send("Inspector.enable"), send("Debugger.enable")]);
    send("Inspector.initialized").catch(() => {});
    const script = await Promise.race([scriptParsed, failed]);

    const [byId, byUrl] = await Promise.all([
      send("Debugger.setBreakpoint", {
        location: { scriptId: script.scriptId, lineNumber: 1, columnNumber: 0 },
      }),
      send("Debugger.setBreakpointByUrl", { url: script.url, lineNumber: 2, columnNumber: 0 }),
    ]);

    expect({ scriptType: script.scriptType, byId, byUrl }).toEqual({
      scriptType: "module",
      byId: {
        id: expect.any(Number),
        result: {
          breakpointId: expect.any(String),
          actualLocation: { scriptId: script.scriptId, lineNumber: 1, columnNumber: expect.any(Number) },
        },
      },
      byUrl: {
        id: expect.any(Number),
        result: {
          breakpointId: expect.any(String),
          locations: [{ scriptId: script.scriptId, lineNumber: 2, columnNumber: expect.any(Number) }],
        },
      },
    });
  } finally {
    ws.close();
  }
});
