import type { Subprocess } from "bun";
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

/** Inspector activation involves a thread handoff plus a server start; this bounds each wait. */
export const STREAM_TIMEOUT_MS = 30_000;

/**
 * Reads `reader` until `condition(accumulated)` holds or the stream ends.
 * Each read is raced against one timer so a child that is alive but silent
 * fails with whatever it did print, instead of hanging to the test timeout.
 */
export async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  condition: (output: string) => boolean,
  timeoutMs = STREAM_TIMEOUT_MS,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`Timed out after ${timeoutMs}ms waiting for stream condition. Got: ${JSON.stringify(output)}`),
        ),
      timeoutMs,
    );
    timer.unref();
  });
  timeout.catch(() => {});

  try {
    while (!condition(output)) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    clearTimeout(timer);
  }
}

/** Drains `reader` to EOF, appending to `prefix`. Use after killing the child. */
export async function readStreamToEnd(reader: ReadableStreamDefaultReader<Uint8Array>, prefix = ""): Promise<string> {
  const decoder = new TextDecoder();
  let output = prefix;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

/** The activation banner prints "Bun Inspector" in both its header and footer rule. */
export function countBanners(stderr: string): number {
  return (stderr.match(/Bun Inspector/g) ?? []).length / 2;
}

export function hasBanner(stderr: string): boolean {
  return countBanners(stderr) >= 1;
}

/** Reads the target's stderr until one full banner has been printed. */
export async function waitForBanner(proc: Subprocess<any, any, "pipe">): Promise<string> {
  const reader = proc.stderr.getReader();
  try {
    return await readStreamUntil(reader, hasBanner);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Environment for the process being inspected. Answering `Runtime.evaluate` (or pausing) runs
 * JSC's InjectedScript, whose unchecked getOwnNonIndexPropertyNames exception scope in the prebuilt
 * WebKit aborts the process under BUN_JSC_validateExceptionChecks, which the ASAN lanes set (the
 * reason test/cli/inspect/inspect.test.ts is in test/no-validate-exceptions.txt). Same workaround
 * as test/js/node/inspector/inspector.test.ts; ASAN/LSAN and the signalling processes keep bunEnv.
 */
export const inspecteeEnv = (() => {
  const { BUN_JSC_validateExceptionChecks, BUN_JSC_dumpSimulatedThrows, ...env } = bunEnv;
  return env;
})();

/**
 * Spawns bun running `script` with a random inspector port and returns once the
 * script has printed its pid, which must be its first stdout line. The script
 * should print it only after any setup the test relies on (signal listeners),
 * since the caller may signal the process as soon as this returns.
 */
export async function spawnTarget(script: string, extraArgs: string[] = []) {
  const proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-port=0", ...extraArgs, "-e", script],
    env: inspecteeEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = proc.stdout.getReader();
    let first: string;
    try {
      first = await readStreamUntil(reader, s => s.includes("\n"));
    } finally {
      reader.releaseLock();
    }
    const pid = parseInt(first, 10);
    expect(pid).toBeGreaterThan(0);
    return { proc, pid };
  } catch (error) {
    proc.kill();
    throw error;
  }
}

/** Runs `process._debugProcess(pid)` in a separate bun and asserts it succeeded. */
export async function debugProcess(pid: number): Promise<void> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode, hasError: stderr.includes("error:") }).toEqual({
    stdout: "",
    exitCode: 0,
    hasError: false,
  });
}

/**
 * Bun.serve binds "localhost" to whichever family resolves first, which on
 * some CI hosts is ::1 while the WebSocket client tries 127.0.0.1 first.
 */
export function connectInspector(url: string): Promise<WebSocket> {
  const attempt = (u: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(u);
      ws.onopen = () => resolve(ws);
      ws.onerror = e => reject(e);
    });
  return attempt(url).catch(() => attempt(url.replace("localhost", "[::1]")));
}

export function wsUrlFromBanner(stderr: string): string {
  const match = stderr.match(/ws:\/\/\S+/);
  expect(match).not.toBeNull();
  return match![0];
}

/** Minimal request/response CDP client over `ws`; `onEvent` sees notifications, protocol errors reject. */
export function cdpClient(ws: WebSocket, onEvent?: (msg: any) => void) {
  let nextId = 1;
  const pending = new Map<number, PromiseWithResolvers<any>>();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data as string);
    if (msg.id === undefined) {
      onEvent?.(msg);
      return;
    }
    const request = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) request?.reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
    else request?.resolve(msg);
  };
  return function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = nextId++;
    const request = Promise.withResolvers<any>();
    pending.set(id, request);
    ws.send(JSON.stringify({ id, method, params }));
    return withTimeout(`response to ${method}`, request.promise);
  };
}

export function withTimeout<T>(label: string, p: Promise<T>, ms = 20_000): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for ${label}`)), ms);
    timer.unref();
  });
  timeout.catch(() => {});
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Keeps the event loop alive without doing anything. */
export const IDLE = `console.log(process.pid); setInterval(() => {}, 1000);`;
/** Never returns to the event loop; only a trap can interrupt it. */
export const BUSY_LOOP = `console.log(process.pid); while (true) {}`;
