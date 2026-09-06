import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { WebSocket } from "ws";

// A debugger client can send a scriptId (or objectId) that does not parse to a
// real id. The inspector agents turned such a string into 0, which is the
// empty-bucket value of the script/injected-script id maps, and looked it up in
// a populated map. Debugger.setBreakpoint and Debugger.getBreakpointLocations
// then dereferenced a null script and crashed the debuggee. This test drives
// those commands with bad ids and asserts the process stays alive and keeps
// answering.
test("inspector survives protocol commands with an invalid scriptId", async () => {
  using dir = tempDir("inspect-invalid-scriptid", {
    "entry.js": `console.log("ready");\nsetInterval(() => {}, 1000);\n`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0/ferritferritferrit", `${dir}/entry.js`],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderr = "";
  const { promise: inspectorUrl, resolve: foundUrl, reject: noUrl } = Promise.withResolvers<string>();
  const stderrDone = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk as Uint8Array, { stream: true });
      const line = stderr
        .split("\n")
        .map(l => l.trim())
        .find(l => l.startsWith("ws://"));
      if (line) foundUrl(line);
    }
    noUrl(new Error(`No inspector URL in stderr:\n${stderr}`));
  })().catch(() => {});

  const ws = new WebSocket(await inspectorUrl);

  const { promise: failed, reject: fail } = Promise.withResolvers<never>();
  failed.catch(() => {});
  async function failWith(what: string): Promise<void> {
    await Promise.race([Promise.allSettled([proc.exited]), Bun.sleep(1000)]);
    const exit = proc.exitCode ?? proc.signalCode ?? "still running";
    fail(new Error(`${what} (inspectee exit: ${exit})\ninspectee stderr:\n${stderr}`));
  }
  ws.addEventListener("error", () => failWith("WebSocket error"));
  ws.addEventListener("close", event => failWith(`WebSocket closed (${event.code})`));
  proc.exited.then(() => failWith("inspectee exited"));

  const responseWaiters = new Map<number, (response: any) => void>();
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("failed to connect")));
  });
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (typeof message.id === "number") responseWaiters.get(message.id)?.(message);
  });

  let nextId = 1;
  function request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return Promise.race([new Promise<any>(resolve => responseWaiters.set(id, resolve)), failed]);
  }

  // Populates the agent's script table, so a lookup can match an empty bucket.
  await request("Debugger.enable");
  // Creates injected script #1, so injectedScriptId 0 matches an empty bucket.
  await request("Runtime.evaluate", { expression: "({})" });

  const badIds = ["", "0", "abc", "-1"];
  for (const scriptId of badIds) {
    // Each command must return a response (an error), never crash the debuggee.
    expect((await request("Debugger.setBreakpoint", { location: { scriptId, lineNumber: 0 } })).id).toBeNumber();
    expect(
      (
        await request("Debugger.getBreakpointLocations", {
          start: { scriptId, lineNumber: 0 },
          end: { scriptId, lineNumber: 100 },
        })
      ).id,
    ).toBeNumber();
    expect((await request("Debugger.getScriptSource", { scriptId })).id).toBeNumber();
    expect((await request("Debugger.searchInContent", { scriptId, query: "x" })).id).toBeNumber();
    expect(
      (await request("Runtime.getProperties", { objectId: `{"injectedScriptId":0,"id":1}` })).id,
    ).toBeNumber();
  }

  // The debuggee is still alive and still answering the protocol.
  const evaluated = await request("Runtime.evaluate", { expression: "1 + 1" });
  expect(evaluated.result?.result?.value).toBe(2);

  ws.close();
  proc.kill();
  await stderrDone;
});
