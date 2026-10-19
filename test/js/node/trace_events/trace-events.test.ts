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

// Node stamps a trace event in native code with uv_hrtime() / 1000: the process.hrtime() clock, in
// microseconds. So a stamp that another process takes between two hrtime readings of this process
// lands between them, and a process.hrtime that user code replaced does not change it.
test.concurrent("a trace event is stamped on the process.hrtime() clock", async () => {
  using dir = tempDir("trace-events-ts", {
    "main.mjs": `
      process.on("message", () => {
        process.hrtime = () => [0, 5_000_000];
        console.time("stamp");
        // A changed title is one more metadata event.
        process.title = "trace-events-ts";
        process.disconnect();
      });
      process.send("ready");
    `,
  });
  const traceFile = join(String(dir), "node_trace.log");
  const ready = Promise.withResolvers<void>();

  const spawned = process.hrtime.bigint() / 1000n;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace-event-categories", "node.console", "--trace-event-file-pattern", traceFile, "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "inherit",
    stderr: "inherit",
    ipc: () => ready.resolve(),
  });
  // The child is running, so the only thing between the readings below is the message hop.
  await Promise.race([
    ready.promise,
    proc.exited.then(code => Promise.reject(new Error(`the child exited (${code}) before it was ready`))),
  ]);

  const sent = process.hrtime.bigint() / 1000n;
  proc.send("stamp");
  const exitCode = await proc.exited;
  const received = process.hrtime.bigint() / 1000n;

  const events = JSON.parse(readFileSync(traceFile, "utf8")).traceEvents;
  const stamps = events.filter(e => e.name === "time::stamp").map(e => BigInt(e.ts));
  const ordered = stamps.length === 1 && sent <= stamps[0] && stamps[0] <= received;
  expect({ sent, stamps, received, ordered, exitCode }).toEqual({ sent, stamps, received, ordered: true, exitCode: 0 });

  // Node stamps the metadata events on the same clock: none of them is at 0.
  const metadata = events.filter(e => e.ph === "M");
  const unstamped = metadata.filter(e => !(spawned <= BigInt(e.ts) && BigInt(e.ts) <= received));
  expect({ titles: metadata.filter(e => e.name === "process_name").length, unstamped }).toEqual({
    titles: 2,
    unstamped: [],
  });
});

// Every thread stamps with the same clock, so in the merged file the event of a worker lies between
// an event that the main thread emitted before it and one that the main thread emitted after it.
test.concurrent("the trace events of a worker are stamped on the clock of the main thread", async () => {
  using dir = tempDir("trace-events-worker-ts", {
    "main.cjs": `
      const { Worker, isMainThread, parentPort } = require("node:worker_threads");
      if (isMainThread) {
        const worker = new Worker(__filename);
        // The worker is running when it says "ready", so the only thing between "before" and
        // "worker" is the message hop.
        worker.once("message", () => {
          console.time("before");
          worker.postMessage("stamp");
        });
        worker.on("exit", () => console.time("after"));
      } else {
        parentPort.once("message", () => {
          console.time("worker");
          parentPort.close();
        });
        parentPort.postMessage("ready");
      }
    `,
  });
  const traceFile = join(String(dir), "node_trace.log");

  const spawned = process.hrtime.bigint() / 1000n;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace-event-categories", "node.console", "--trace-event-file-pattern", traceFile, "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  const exited = process.hrtime.bigint() / 1000n;

  const events = JSON.parse(readFileSync(traceFile, "utf8")).traceEvents;
  const stamps = (label: string) =>
    events.filter(e => e.name === "time::" + label).map(e => ({ tid: e.tid, ts: e.ts }));
  const [before, worker, after] = [stamps("before"), stamps("worker"), stamps("after")];
  const ordered =
    before.length === 1 &&
    worker.length === 1 &&
    after.length === 1 &&
    worker[0].tid !== before[0].tid &&
    after[0].tid === before[0].tid &&
    before[0].ts <= worker[0].ts &&
    worker[0].ts <= after[0].ts;
  expect({ before, worker, after, ordered, exitCode }).toEqual({ before, worker, after, ordered: true, exitCode: 0 });

  // Every event of the file, the thread name of the worker included, lies in the life of the child.
  const outside = events.filter(e => !(spawned <= BigInt(e.ts) && BigInt(e.ts) <= exited));
  expect(outside).toEqual([]);
});
