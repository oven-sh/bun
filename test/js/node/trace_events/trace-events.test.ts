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
