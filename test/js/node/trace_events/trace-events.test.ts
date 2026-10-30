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

// The binding of fs.readFile, fs.writeFile and fs.appendFile returns the error of a signal that is already aborted
// and never calls the callback it was handed, which is where a node.fs.async span ends.
test("node.fs.async spans are closed when the signal is already aborted", async () => {
  using dir = tempDir("trace-events-fs-aborted", {
    "file.txt": "hello",
    "main.cjs": `
      const fs = require("node:fs");
      const signal = AbortSignal.abort();
      const calls = {
        readFile: callback => fs.readFile("file.txt", { signal }, callback),
        writeFile: callback => fs.writeFile("written.txt", "x", { signal }, callback),
        appendFile: callback => fs.appendFile("written.txt", "x", { signal }, callback),
      };
      for (const [name, call] of Object.entries(calls)) {
        call(err => console.log(name, err.name));
        try {
          call(() => { throw new Error("boom"); });
        } catch (err) {
          console.log(name, "caught", err.message);
        }
      }
    `,
  });
  const traceFile = join(String(dir), "node_trace.log");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace-event-categories", "node.fs.async", "--trace-event-file-pattern", traceFile, "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const spans: Record<string, { b: number; e: number }> = {};
  for (const event of JSON.parse(readFileSync(traceFile, "utf8")).traceEvents) {
    if (event.ph !== "b" && event.ph !== "e") continue;
    (spans[event.name] ??= { b: 0, e: 0 })[event.ph as "b" | "e"]++;
  }
  expect({ stdout: stdout.trim().split(/\r?\n/), stderr, exitCode, spans }).toEqual({
    stdout: [
      "readFile AbortError",
      "readFile caught boom",
      "writeFile AbortError",
      "writeFile caught boom",
      "appendFile AbortError",
      "appendFile caught boom",
    ],
    stderr: "",
    exitCode: 0,
    // Two calls of each: readFile is open, fstat, read and close, the other two are open, write and close.
    spans: {
      open: { b: 6, e: 6 },
      fstat: { b: 2, e: 2 },
      read: { b: 2, e: 2 },
      write: { b: 4, e: 4 },
      close: { b: 6, e: 6 },
    },
  });
});
