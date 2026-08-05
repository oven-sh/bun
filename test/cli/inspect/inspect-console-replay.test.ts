import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A frontend that attaches to plain `--inspect` after the program has already
// logged should receive those messages when it sends Console.enable, like
// node --inspect and like Bun's own --inspect-wait path already did.
test("Console.enable replays console messages logged before the debugger attached", async () => {
  // The child logs BOOT-A/BOOT-B, writes a BOOTED sentinel to stderr, then
  // keeps itself alive. We only attach after BOOTED appears so the boot logs
  // are guaranteed to have run with no frontend connected.
  // Console.enable's replay loop reaches InjectedScript through a code path
  // that currently trips validateExceptionChecks (getOwnNonIndexPropertyNames
  // followed by an unchecked get); that is a pre-existing JSC-side issue
  // reproducible under --inspect-wait as well, so don't propagate the ASAN
  // lane's validation flags into the inspectee.
  const env = {
    ...bunEnv,
    BUN_JSC_validateExceptionChecks: undefined,
    BUN_JSC_dumpSimulatedThrows: undefined,
  };
  await using proc = spawn({
    cmd: [
      bunExe(),
      "--inspect=127.0.0.1:0",
      "-e",
      `console.log("BOOT-A"); console.log("BOOT-B"); process.stderr.write("BOOTED\\n"); setInterval(()=>{},1000);`,
    ],
    env,
    stdout: "ignore",
    stderr: "pipe",
  });

  let wsUrl: URL | undefined;
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    if (!wsUrl) {
      const m = stderr.match(/ws:\/\/\S+/);
      if (m) wsUrl = new URL(m[0]);
    }
    if (wsUrl && stderr.includes("BOOTED")) break;
  }
  if (!wsUrl) {
    process.stderr.write(stderr);
    throw new Error("Unable to find listening URL");
  }

  const ws = new WebSocket(wsUrl);
  try {
    const messages: string[] = [];
    let nextId = 1;
    let failed: Error | undefined;
    const pending = new Map<number, { resolve: (x: unknown) => void; reject: (e: unknown) => void }>();
    const send = (method: string, params: object = {}) =>
      new Promise((resolve, reject) => {
        if (failed) return reject(failed);
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const fail = (e: Error) => {
      failed ??= e;
      for (const p of pending.values()) p.reject(failed);
      pending.clear();
    };
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!.resolve(msg);
        pending.delete(msg.id);
      } else if (msg.method === "Console.messageAdded") {
        messages.push(msg.params.message.text);
      }
    });
    ws.addEventListener("error", cause => fail(new Error("WebSocket error", { cause })));
    ws.addEventListener("close", cause => fail(new Error("WebSocket closed", { cause })));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
      ws.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
    });

    // InspectorConsoleAgent::enable replays its buffer synchronously before
    // the reply is sent, so by the time the Console.enable response arrives
    // every buffered Console.messageAdded has already been delivered. One
    // extra round-trip guards against any cross-thread dispatch reordering.
    await send("Console.enable");
    await send("Runtime.evaluate", { expression: "1" });

    expect(messages).toEqual(["BOOT-A", "BOOT-B"]);
  } finally {
    ws.close();
  }
});
