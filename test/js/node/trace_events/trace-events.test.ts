import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The 'http.client.request' trace span must be closed on every terminal path,
// including ones that never reach the parser or the emitErrorEvent funnel.
test("http.client.request span is closed when the proxy CONNECT tunnel fails", async () => {
  using dir = tempDir("trace-events-proxy", {
    // A fake proxy that rejects the CONNECT with 502 -> ERR_PROXY_TUNNEL on the request.
    "main.mjs": `
      import net from "node:net";
      import https from "node:https";
      const proxy = net.createServer(s => {
        s.once("data", () => { s.end("HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n"); });
      });
      proxy.listen(0, "127.0.0.1", () => {
        const agent = new https.Agent({
          proxyEnv: { HTTPS_PROXY: \`http://127.0.0.1:\${proxy.address().port}\` },
        });
        const r = https.request({ host: "example.invalid", port: 443, path: "/", agent });
        r.on("error", e => { console.log("errored", e.code); proxy.close(); });
        r.end();
      });
    `,
  });
  const traceFile = join(String(dir), "node_trace.log");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace-event-categories", "node.http", "--trace-event-file-pattern", traceFile, "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The scenario must actually have happened for the assertion below to mean anything.
  expect(stdout).toContain("errored ERR_PROXY_TUNNEL");

  const events = JSON.parse(readFileSync(traceFile, "utf8")).traceEvents;
  const phases = events.filter(e => e.name === "http.client.request").map(e => e.ph);
  expect({ phases: phases.sort(), exitCode }).toEqual({ phases: ["b", "e"], exitCode: 0 });
});

// A builtin module calls the timer functions that script cannot replace, so the tracing has to wrap those.
test.each([
  ["--trace-event-categories", ["--trace-event-categories", "node.async_hooks", "main.cjs"]],
  ["createTracing().enable() before node:net is loaded", ["main.cjs", "enable-first"]],
  ["createTracing().enable() after node:net is loaded", ["main.cjs", "load-first"]],
])("Timeout events of a timer that node:net sets for itself, with %s", async (_, args) => {
  using dir = tempDir("trace-events-builtin-timer", {
    "main.cjs": `
      const enable = () => require("node:trace_events").createTracing({ categories: ["node.async_hooks"] }).enable();
      if (process.argv[2] === "enable-first") enable();
      const net = require("node:net");
      if (process.argv[2] === "load-first") enable();
      const socket = new net.Socket();
      socket.setTimeout(60_000);
      socket.setTimeout(0);
      console.log(socket.timeout);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });

  const events = JSON.parse(readFileSync(join(String(dir), "node_trace.1.log"), "utf8")).traceEvents;
  expect(events.filter(e => e.name === "Timeout").map(e => e.ph)).toEqual(["b", "e"]);
});
