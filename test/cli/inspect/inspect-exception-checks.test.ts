import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// jsToInspectorValue (InjectedScriptBase.cpp) called getOwnPropertyNames and then object.get()
// on each property with no exception check between them. The live console.log path has a JS
// topEntryFrame on the stack so the inner ThrowScope destructor skips the simulated throw, but
// InspectorConsoleAgent::enable()'s replay of buffered messages runs from backend dispatch with
// no JS frame, so validation trips: "getOwnNonIndexPropertyNames ... unchecked as of get".
// ENABLE_EXCEPTION_SCOPE_VERIFICATION is (ASSERT_ENABLED || ASAN_ENABLED), so this only runs on
// debug / asan builds.
test.skipIf(!isDebug && !isASAN)(
  "Console.enable replay of buffered messages does not trip exception-check validation",
  async () => {
    await using child = spawn({
      cmd: [
        bunExe(),
        "--inspect-wait=127.0.0.1:0",
        "-e",
        `console.log("BUFFER-A"); console.log("BUFFER-B"); setInterval(()=>{},1000);`,
      ],
      env: {
        ...bunEnv,
        BUN_JSC_validateExceptionChecks: "1",
        BUN_JSC_dumpSimulatedThrows: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    let stderr = "";
    let stdout = "";
    const decoder = new TextDecoder();
    const { promise: urlPromise, resolve: resolveUrl, reject: rejectUrl } = Promise.withResolvers<URL>();
    const stderrDrained = (async () => {
      for await (const chunk of child.stderr) {
        stderr += decoder.decode(chunk);
        const m = stderr.match(/ws:\/\/[^\s]+/);
        if (m) resolveUrl(new URL(m[0]));
      }
      rejectUrl(new Error("inspectee exited before printing inspector URL:\n" + stderr));
    })();
    const { promise: bufferedPromise, resolve: resolveBuffered } = Promise.withResolvers<void>();
    const stdoutDrained = (async () => {
      for await (const chunk of child.stdout) {
        stdout += decoder.decode(chunk);
        if (stdout.includes("BUFFER-A") && stdout.includes("BUFFER-B")) resolveBuffered();
      }
    })();

    const url = await urlPromise;
    const ws = new WebSocket(url);
    const replayed: string[] = [];
    let reply: unknown;
    try {
      let nextId = 1;
      let failed: unknown;
      const pending = new Map<number, (x: unknown) => void>();
      const send = (method: string, params: object = {}) =>
        new Promise<unknown>(resolve => {
          if (failed) return resolve(failed);
          const id = nextId++;
          pending.set(id, resolve);
          ws.send(JSON.stringify({ id, method, params }));
        });
      const fail = (r: unknown) => {
        failed ??= r;
        for (const p of pending.values()) p(r);
        pending.clear();
      };
      ws.addEventListener("message", ev => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        } else if (msg.method === "Console.messageAdded") {
          replayed.push(msg.params.message.text);
        }
      });
      ws.addEventListener("close", ({ code, reason }) => fail({ closed: { code, reason } }));
      ws.addEventListener("error", cause => fail({ error: String(cause) }));
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
      });

      // Let user code run and buffer the two console.log calls in InspectorConsoleAgent,
      // then send Console.enable so enable() replays them with no JS on the stack.
      await send("Inspector.enable");
      await send("Inspector.initialized");
      await Promise.race([bufferedPromise, child.exited]);
      // enable() dispatches the buffered Console.messageAdded events synchronously before
      // replying, so once this resolves the replayed[] array is complete. A second round-trip
      // guards against any cross-thread delivery reordering.
      reply = await send("Console.enable");
      await send("Runtime.evaluate", { expression: "1" });
    } finally {
      ws.close();
      child.kill();
    }

    await Promise.all([child.exited, stderrDrained.catch(() => {}), stdoutDrained]);
    // Without the WebKit-side fix the inspectee SIGABRTs ("Unchecked JS exception:
    // getOwnNonIndexPropertyNames ... unchecked as of get") inside toInspectorValue before
    // replying to Console.enable, so the socket closes 1006 and reply is { closed: ... }.
    if (child.signalCode === "SIGABRT") {
      throw new Error(`inspectee aborted under validateExceptionChecks (reply=${JSON.stringify(reply)}):\n${stderr}`);
    }
    expect(reply).toMatchObject({ id: expect.any(Number), result: {} });
    expect(replayed).toEqual(expect.arrayContaining(["BUFFER-A", "BUFFER-B"]));
  },
);
