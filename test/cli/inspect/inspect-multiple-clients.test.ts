import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { WebSocket } from "ws";

// Runtime.evaluate goes through JSC's InjectedScript, which has missing
// RELEASE_AND_RETURN wraps in the prebuilt WebKit that abort the inspectee
// under validateExceptionChecks (see inspector.test.ts injectedScriptChildEnv).
const { BUN_JSC_validateExceptionChecks, BUN_JSC_dumpSimulatedThrows, ...inspecteeEnv } = bunEnv;

// JSGlobalObjectInspectorController::disconnectFrontend tears down every agent
// (willDestroyFrontendAndBackend) before its last-frontend check, so without
// Bun's per-connection routing a second client's close would silently disable
// Console/Runtime/Debugger for the still-attached first client.
test("a second --inspect client disconnecting does not disable inspector agents for the first", async () => {
  using dir = tempDir("inspect-second-client", {
    "keepalive.js": "setInterval(() => {}, 1e9);\n",
  });
  await using proc = spawn({
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", join(String(dir), "keepalive.js")],
    env: inspecteeEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  let url: URL | undefined;
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    for (const line of stderr.split("\n")) {
      try {
        const candidate = new URL(line);
        if (candidate.protocol.includes("ws")) url = candidate;
      } catch {}
    }
    if (url || stderr.includes("Listening:")) break;
  }
  if (!url) {
    process.stderr.write(stderr);
    throw new Error("Unable to find inspector URL");
  }

  const consoleTexts: string[] = [];
  const pending = new Map<number, { resolve: (message: any) => void; reject: (err: unknown) => void }>();
  let nextId = 1;
  let aClosed = false;

  const a = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    a.addEventListener("open", () => resolve());
    a.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
  });
  a.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!.resolve(message);
      pending.delete(message.id);
    } else if (message.method === "Console.messageAdded") {
      consoleTexts.push(message.params?.message?.text ?? "");
    }
  });
  const failPending = (cause: unknown) => {
    aClosed = true;
    const err = new Error("inspector socket closed before response", { cause });
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };
  a.addEventListener("close", failPending);
  a.addEventListener("error", failPending);
  const send = (method: string, params?: object) =>
    new Promise<any>((resolve, reject) => {
      if (aClosed) return reject(new Error("inspector socket already closed"));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      a.send(JSON.stringify({ id, method, params }));
    });

  await send("Inspector.enable");
  await send("Console.enable");
  await send("Runtime.enable");
  await send("Inspector.initialized");

  // The Console.messageAdded event for a console.log inside Runtime.evaluate is
  // emitted synchronously during dispatch, so it arrives on this socket before
  // the evaluate response does.
  await send("Runtime.evaluate", { expression: "console.log('probe-before')" });
  expect(consoleTexts).toContain("probe-before");

  const b = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    b.addEventListener("open", () => resolve());
    b.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
  });
  // One round-trip so B is registered as a FrontendChannel on the inspected
  // thread before it closes; a socket that never reached connectFrontend
  // wouldn't exercise the agent-teardown path on disconnect. B never enables
  // any domain, so this can't be the source of a later disable.
  const bCommandId = 1 << 20;
  const bReady = new Promise<void>((resolve, reject) => {
    b.addEventListener("message", ({ data }) => {
      if (JSON.parse(String(data)).id === bCommandId) resolve();
    });
    b.addEventListener("close", cause => reject(new Error("B closed before round-trip", { cause })));
    b.addEventListener("error", cause => reject(new Error("B errored before round-trip", { cause })));
  });
  b.send(JSON.stringify({ id: bCommandId, method: "Runtime.evaluate", params: { expression: "0" } }));
  await bReady;
  const bClosed = new Promise<void>(resolve => b.addEventListener("close", () => resolve()));
  b.close();
  await bClosed;

  // One round-trip so B's disconnect task (posted to the inspected thread before
  // this message was) has run before the probe below.
  await send("Runtime.evaluate", { expression: "0" });

  await send("Runtime.evaluate", { expression: "console.log('probe-after')" });
  expect(consoleTexts).toContain("probe-after");

  a.close();
  proc.kill();
});
