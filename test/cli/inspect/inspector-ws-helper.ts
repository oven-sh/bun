// Shared helper for tests that drive a debuggee via the WebSocket inspector
// transport (`--inspect-wait=ws://127.0.0.1:0/...`). Spawns the child, parses
// the inspector banner from stderr for the WebSocket URL, connects, and returns
// thin `send` / `waitForEvent` helpers over the JSC inspector protocol.
//
// Call `[Symbol.asyncDispose]()` (or use `await using`) when done; it closes
// the socket first so the debuggee's event loop is released, then awaits exit.

import type { Subprocess } from "bun";
import { bunEnv, bunExe } from "harness";

type Waiter = { resolve: (value: any) => void; reject: (error: Error) => void };

export type InspectorSessionWS = {
  readonly proc: Subprocess<"ignore", "pipe", "pipe">;
  readonly ws: WebSocket;
  readonly stderr: () => string;
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  waitForEvent: (method: string) => Promise<any>;
  close: () => void;
  [Symbol.asyncDispose]: () => Promise<void>;
};

export async function spawnInspectorWS(options: {
  args: string[];
  cwd?: string;
  urlPath?: string;
  env?: Record<string, string | undefined>;
}): Promise<InspectorSessionWS> {
  const { args, cwd, urlPath = "/bun-inspector", env = bunEnv } = options;

  const proc = Bun.spawn({
    cmd: [bunExe(), `--inspect-wait=ws://127.0.0.1:0${urlPath}`, ...args],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Drain stderr in the background so it never back-pressures the child, and
  // pull the WebSocket URL from the inspector banner. Only scan complete
  // (newline-terminated) lines so a chunk boundary can't split the URL.
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
    if (!urlFound) urlReject(new Error(`inspector URL not found before child stderr closed: ${JSON.stringify(stderrBuf)}`));
  })().catch(err => {
    if (!urlFound) urlReject(err);
  });

  let ws: WebSocket;
  try {
    const url = await urlPromise;
    ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", e => reject(new Error("WebSocket error", { cause: e })), { once: true });
      ws.addEventListener("close", e => reject(new Error("WebSocket closed", { cause: e })), { once: true });
    });
  } catch (err) {
    proc.kill();
    await proc.exited;
    throw err;
  }

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

  const close = () => {
    try {
      ws.close();
    } catch {}
  };

  return {
    proc,
    ws,
    stderr: () => stderrBuf,
    send,
    waitForEvent,
    close,
    async [Symbol.asyncDispose]() {
      close();
      proc.kill();
      await proc.exited;
    },
  };
}

/**
 * Enable the inspector + debugger, opt into pausing on `debugger;` statements,
 * and release `--inspect-wait`. Resolves with the first `Debugger.paused`
 * event's params.
 */
export async function enableAndWaitForDebuggerPause(session: InspectorSessionWS): Promise<any> {
  const { send, waitForEvent } = session;
  await Promise.all([
    send("Inspector.enable"),
    send("Debugger.enable"),
    send("Debugger.setBreakpointsActive", { active: true }),
    send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
  ]);
  const pausedPromise = waitForEvent("Debugger.paused");
  send("Inspector.initialized").catch(() => {});
  return pausedPromise;
}
