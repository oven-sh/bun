// `Debugger.addSymbolicBreakpoint` (a function breakpoint in VS Code) makes JSC swap the
// entry points of every native function whose name matches. JSC aborted when the name
// matched a bun:ffi function, because two of that function's NativeExecutables shared
// one JITCode. See oven-sh/WebKit#720.
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("a symbolic breakpoint pauses on a bun:ffi function and the call returns", async () => {
  using dir = tempDir("inspect-symbolic-breakpoint-ffi", {
    "symbolic-breakpoint-fixture.js": `
      import { JSCallback, linkSymbols } from "bun:ffi";

      const callback = new JSCallback(() => 42, { returns: "int32_t", args: [] });
      const link = () =>
        linkSymbols({ ffiBreakpointTarget: { ptr: callback.ptr, returns: "int32_t", args: [] } }).symbols
          .ffiBreakpointTarget;

      // Two functions of one name exist before the breakpoint does.
      const first = link();
      const second = link();
      console.log(first.name, first(), second());
      debugger;
      console.log(first());
      console.log(second());
      // A function made while the breakpoint is set.
      const third = link();
      console.log(third());
      process.exit(0);
    `,
  });

  await using proc = spawn({
    cmd: [
      bunExe(),
      "--inspect-wait=ws://127.0.0.1:0/symbolic-breakpoint-ffi",
      join(String(dir), "symbolic-breakpoint-fixture.js"),
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // The inspector prints its WebSocket URL on a line of stderr. Keep draining stderr afterwards.
  let stderr = "";
  const { promise: urlPromise, resolve: resolveUrl, reject: rejectUrl } = Promise.withResolvers<string>();
  const stderrDone = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      stderr += decoder.decode(chunk, { stream: true });
      const match = stderr.match(/(ws:\/\/\S+)\r?\n/);
      if (match) resolveUrl(match[1]);
    }
    rejectUrl(new Error(`No inspector URL in stderr: ${JSON.stringify(stderr)}`));
  })();
  const stdoutPromise = proc.stdout.text();

  const ws = new WebSocket(await urlPromise);
  const pending = new Map<number, (reply: any) => void>();
  const pauses: { reason: string; name?: string }[] = [];
  let nextId = 1;
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>(resolve => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  let addBreakpointReply: any;
  ws.addEventListener("message", async event => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === "number") {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }
    if (message.method !== "Debugger.paused") return;
    pauses.push({ reason: message.params.reason, name: message.params.data?.name });
    if (message.params.reason === "DebuggerStatement") {
      addBreakpointReply = await send("Debugger.addSymbolicBreakpoint", { symbol: "ffiBreakpointTarget" });
    }
    send("Debugger.resume");
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", event => reject(new Error("WebSocket error", { cause: event })), { once: true });
  });

  await Promise.all([
    send("Inspector.enable"),
    send("Debugger.enable"),
    send("Debugger.setBreakpointsActive", { active: true }),
    send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
  ]);
  send("Inspector.initialized");

  const [stdout, exitCode] = await Promise.all([stdoutPromise, proc.exited, stderrDone]);
  ws.close();

  // signalCode is part of this so that a debuggee that JSC aborted shows up as SIGABRT in the diff.
  expect({ addBreakpointReply, pauses, stdout, signalCode: proc.signalCode }).toEqual({
    addBreakpointReply: { id: expect.any(Number), result: {} },
    pauses: [
      { reason: "DebuggerStatement", name: undefined },
      { reason: "FunctionCall", name: "ffiBreakpointTarget" },
      { reason: "FunctionCall", name: "ffiBreakpointTarget" },
      { reason: "FunctionCall", name: "ffiBreakpointTarget" },
    ],
    stdout: "ffiBreakpointTarget 42 42\n42\n42\n42\n",
    signalCode: null,
  });
  expect(exitCode).toBe(0);
});
