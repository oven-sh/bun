import { Subprocess, spawn } from "bun";
import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

let inspectee: Subprocess | undefined;

afterEach(() => {
  inspectee?.kill();
});

function waitForReply(ws: WebSocket, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }: MessageEvent) => {
      const parsed = JSON.parse(String(data));
      if (parsed.id === id) {
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("error", onError);
        resolve(parsed);
      }
    };
    const onClose = (ev: CloseEvent) => reject(new Error(`closed (${ev.code} ${ev.reason}) before reply id=${id}`));
    const onError = (cause: unknown) => reject(new Error("WebSocket error", { cause }));
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onError);
  });
}

test("binary frame closes the inspector websocket with 1003 instead of leaving a mute open socket", async () => {
  inspectee = spawn({
    cwd: import.meta.dir,
    cmd: [bunExe(), "--inspect=127.0.0.1:0", "inspectee.js"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  // Drain stderr in the background: breaking a for-await on proc.stderr cancels
  // the stream and closes the pipe, which can EPIPE the debugger thread's
  // still-pending async banner writes and abort the first connection.
  let stderr = "";
  const decoder = new TextDecoder();
  const gotUrl = Promise.withResolvers<URL>();
  void (async () => {
    for await (const chunk of inspectee!.stderr as ReadableStream) {
      stderr += decoder.decode(chunk);
      const m = stderr.match(/ws:\/\/\S+/);
      if (m) gotUrl.resolve(new URL(m[0]));
    }
  })().catch(() => {});
  inspectee.exited.then(code => gotUrl.reject(new Error(`inspectee exited (${code}) before listening:\n${stderr}`)));

  const url = await gotUrl.promise;

  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
  });

  // Sanity: the session answers before the binary frame.
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
  const before = await waitForReply(ws, 1);
  expect(before).toMatchObject({ id: 1, result: { result: { type: "number", value: 2 } } });

  const closed = new Promise<{ code: number; reason: string }>(resolve => {
    ws.addEventListener("close", ev => resolve({ code: ev.code, reason: ev.reason }));
  });

  // A binary frame must not leave the socket open-but-deaf: it should close
  // with 1003 (unsupported data). Previously the backend was torn down while
  // the WebSocket stayed OPEN, so every later request went unanswered.
  ws.send(new Uint8Array([1, 2, 3]));
  ws.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression: "2 + 2" } }));

  const outcome = await Promise.race([
    closed.then(ev => ({ kind: "close" as const, ...ev })),
    new Promise<{ kind: "reply"; data: any }>(resolve => {
      const onMessage = ({ data }: MessageEvent) => {
        const parsed = JSON.parse(String(data));
        if (parsed.id === 2) {
          ws.removeEventListener("message", onMessage);
          resolve({ kind: "reply", data: parsed });
        }
      };
      ws.addEventListener("message", onMessage);
    }),
  ]);

  expect(outcome).toEqual({ kind: "close", code: 1003, reason: expect.stringContaining("inary") });

  // A fresh connection to the same inspectee still works.
  const ws2 = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws2.addEventListener("open", () => resolve());
    ws2.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
  });
  ws2.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "3 + 3" } }));
  const after = await waitForReply(ws2, 1);
  expect(after).toMatchObject({ id: 1, result: { result: { type: "number", value: 6 } } });
  ws2.close();
});
