import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("rapid inspector connect/close does not unref the debuggee's event loop", async () => {
  // A close that arrives before the queued context-thread connect task runs used to
  // skip the +1 while the disconnect task still applied its -1. Enough raced cycles
  // drove the debuggee's loop refcount to zero and it exited 0 mid-run.
  using dir = tempDir("inspect-churn", {
    "debuggee.js": `
      Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("alive") });
      let tick = 0;
      setInterval(() => {
        process.stdout.write("TICK " + ++tick + "\\n");
        const until = Date.now() + 400;
        while (Date.now() < until) {}
      }, 50);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0/insp", "debuggee.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  let stderr = "";
  let stderrTail = "";
  let inspectorUrl: URL | undefined;
  for await (const chunk of proc.stderr) {
    const text = Buffer.from(chunk).toString();
    stderr += text;
    stderrTail += text;
    const lines = stderrTail.split("\n");
    // Leave the unterminated tail for the next chunk so a URL split across
    // reads is not parsed as a truncated endpoint.
    stderrTail = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("ws://")) {
        inspectorUrl = new URL(trimmed);
        break;
      }
    }
    if (inspectorUrl || lines.some(l => l.includes("error"))) break;
  }
  if (!inspectorUrl) throw new Error("inspector URL not found in stderr:\n" + stderr);

  // Build a promise that resolves when the Nth TICK line is seen, and a way
  // to await a given tick without polling time.
  let ticksSeen = 0;
  const tickWaiters: { n: number; resolve: () => void }[] = [];
  (async () => {
    let stdout = "";
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      while (stdout.includes("\n")) {
        const nl = stdout.indexOf("\n");
        const line = stdout.slice(0, nl);
        stdout = stdout.slice(nl + 1);
        if (line.startsWith("TICK ")) {
          ticksSeen++;
          for (const w of tickWaiters) if (ticksSeen >= w.n) w.resolve();
        }
      }
    }
  })();
  const waitForTick = (n: number) =>
    ticksSeen >= n
      ? Promise.resolve()
      : new Promise<void>(resolve => {
          tickWaiters.push({ n, resolve });
        });

  // Wait until the debuggee is inside its first busy burst so the churn lands
  // while the context thread is blocked.
  await Promise.race([waitForTick(1), proc.exited.then(() => Promise.reject(new Error("exited before first tick")))]);

  // Churn: rapid connect/close on the debugger thread while the debuggee's
  // context thread is busy. The debugger-thread WS server stays responsive.
  let opened = 0;
  for (let i = 0; i < 40; i++) {
    const ws = new WebSocket(inspectorUrl);
    await new Promise<void>((resolve, reject) => {
      let didOpen = false;
      ws.addEventListener("open", () => {
        didOpen = true;
        opened++;
        ws.close();
      });
      ws.addEventListener("close", event => {
        if (didOpen) resolve();
        else reject(new Error("inspector WebSocket closed before opening", { cause: event }));
      });
      ws.addEventListener("error", event => {
        reject(new Error("inspector WebSocket error", { cause: event }));
      });
    });
  }

  // The debuggee must survive past the tick that applies the accumulated
  // concurrent-ref delta. Race the next few ticks against process exit.
  const target = ticksSeen + 3;
  const outcome = await Promise.race([
    waitForTick(target).then(() => "alive" as const),
    proc.exited.then(code => `exited code=${code} signal=${proc.signalCode}` as const),
  ]);

  expect({ opened, outcome, ticksSeen: ticksSeen >= target ? `>=${target}` : ticksSeen }).toEqual({
    opened: 40,
    outcome: "alive",
    ticksSeen: `>=${target}`,
  });
});
