import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isLinux, joinP, tempDir, tempDirWithFiles } from "harness";

test("cloneable and transferable equals", () => {
  const dir = tempDirWithFiles("bun-test", {
    "index.ts": `
import cluster from "cluster";
import { expect } from "bun:test";
if (cluster.isPrimary) {
  cluster.settings.serialization = "advanced";
  const worker = cluster.fork();
  const original = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const buf = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const ab = buf.buffer.transfer();
  expect(ab).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(ab)).toEqual(original);
  worker.on("online", function () {
    worker.send(ab);
  });
  worker.on("message", function (data) {
    worker.kill();
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(data)).toEqual(original);
    process.exit(0);
  });
} else {
  process.on("message", msg => {
    console.log("W", msg);
    process.send!(msg);
  });
}
`,
  });
  bunRun(joinP(dir, "index.ts"), bunEnv, true);
});

test("cloneable and non-transferable not-equals (BunFile)", () => {
  const dir = tempDirWithFiles("bun-test", {
    "index.ts": `
import cluster from "cluster";
import { expect } from "bun:test";
if (cluster.isPrimary) {
  cluster.settings.serialization = "advanced";
  const worker = cluster.fork();
  const file = Bun.file(import.meta.filename);
  console.log("P", "O", file);
  expect(file).toBeInstanceOf(Blob); // Bun.BunFile isnt exposed to JS
  expect(file.name).toEqual(import.meta.filename);
  expect(file.type).toEqual("text/javascript;charset=utf-8");
  worker.on("online", function () {
    worker.send({ file });
  });
  worker.on("exit", function (code, signal) {
    if (code !== 0) {
      process.exit(code);
    }
  });
  worker.on("message", function (data) {
    worker.kill();
    const { file } = data;
    console.log("P", "M", file);
    expect(file.name).toBeUndefined();
    expect(file.type).toBeUndefined();
    expect(file).toBeEmptyObject();
    process.exit(0);
  });
} else {
  process.on("message", msg => {
    console.log("W", msg);
    process.send!(msg);
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    console.error(error);
    process.exit(1);
  });
}
`,
  });
  bunRun(joinP(dir, "index.ts"), bunEnv, true);
});

test("cloneable and non-transferable not-equals (net.BlockList)", () => {
  const dir = tempDirWithFiles("bun-test", {
    "index.ts": `
import cluster from "cluster";
import net from "net";
import { expect } from "bun:test";
if (cluster.isPrimary) {
  cluster.settings.serialization = "advanced";
  const worker = cluster.fork();
  const blocklist = new net.BlockList();
  console.log("P", "O", blocklist);
  blocklist.addAddress("123.123.123.123");
  worker.on("online", function () {
    worker.send({ blocklist });
  });
  worker.on("exit", function (code, signal) {
    if (code !== 0) {
      process.exit(code);
    }
  });
  worker.on("message", function (data) {
    worker.kill();
    const { blocklist } = data;
    console.log("P", "M", blocklist);
    expect(blocklist.rules).toBeUndefined();
    expect(blocklist).toBeEmptyObject();
    process.exit(0);
  });
} else {
  process.on("message", msg => {
    console.log("W", msg);
    process.send!(msg); 
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    console.error(error);
    process.exit(1);
  });
}
`,
  });
  bunRun(joinP(dir, "index.ts"), bunEnv, true);
});

test("non-cluster parent ignores cluster-internal IPC messages from a forked child", () => {
  const dir = tempDirWithFiles("bun-test", {
    "parent.ts": `
const { fork } = require("node:child_process");
const path = require("node:path");

// Plain child_process.fork — this process never touches node:cluster's
// primary API, so no cluster message handler is registered for the child.
const child = fork(path.join(__dirname, "child.ts"), [], {
  env: { ...process.env, NODE_UNIQUE_ID: "1" },
});

child.on("message", msg => {
  if (msg === "regular message") {
    console.log("P received regular message");
    child.kill();
    process.exit(0);
  }
});

child.on("exit", (code, signal) => {
  // The child must stay alive until the parent has seen the regular message.
  console.error("child exited early", code, signal);
  process.exit(1);
});
`,
    "child.ts": `
// With NODE_UNIQUE_ID set, loading node:cluster makes this process behave as a
// cluster worker: it immediately writes a cluster-internal {act:"online"} IPC
// frame to its parent, even though the parent never registered node:cluster's
// primary callback. The parent must drop that frame instead of crashing.
require("node:cluster");
process.send("regular message");
`,
  });
  const { stdout } = bunRun(joinP(dir, "parent.ts"), bunEnv);
  expect(stdout).toContain("P received regular message");
});

test("disconnect() on a cluster.Worker built around a plain object does not abort", async () => {
  // `kHandle` is a private symbol that only `cluster.fork()` sets, so a
  // `cluster.Worker({ process })` built around a plain object (how Node's own
  // tests mock workers) hands `undefined` to the native `sendHelper` binding.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const cluster = require("node:cluster");
        const fake = { on() {}, disconnect() {}, kill() {}, send() { return false; } };
        const worker = new cluster.Worker({ process: fake });
        const returned = worker.disconnect();
        console.log("returned self:", returned === worker);
      `,
    ],
    env: bunEnv,
    // Inherited so that on regression the child's abort output reaches the
    // runner log instead of filling an unread pipe.
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "returned self: true", exitCode: 0 });
});

// https://github.com/oven-sh/bun/issues/14727
// Each test spawns a primary that forks two workers: three debug+ASAN bun
// processes, so the default 5s per-test budget is not enough.
describe("net.Server in cluster worker", () => {
  test("workers listening on port: 0 agree on a single port", async () => {
    // Previously each worker would bind its own random port because the
    // worker ignored the primary's resolved sockname and called Bun.listen()
    // with the original port: 0.
    using dir = tempDir("cluster-net-port0", {
      "index.ts": `
import cluster from "node:cluster";
import net from "node:net";

if (cluster.isPrimary) {
  const ports: number[] = [];
  for (let i = 0; i < 2; i++) {
    const w = cluster.fork();
    w.on("message", (msg) => {
      if (typeof msg?.port === "number") {
        ports.push(msg.port);
        if (ports.length === 2) {
          for (const worker of Object.values(cluster.workers!)) worker!.kill();
          console.log(JSON.stringify({ ports, same: ports[0] === ports[1] }));
          process.exit(ports[0] === ports[1] ? 0 : 1);
        }
      }
    });
    w.on("exit", (code) => {
      if (code !== 0 && code !== null) process.exit(code);
    });
  }
} else {
  const server = net.createServer(() => {});
  server.on("error", (err) => {
    console.error("worker listen error:", err.message);
    process.exit(1);
  });
  server.listen(0, () => {
    process.send!({ port: server.address().port });
  });
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.ports).toHaveLength(2);
    expect(result.ports[0]).toBe(result.ports[1]);
    expect(exitCode).toBe(0);
  }, 20_000);

  // SO_REUSEPORT load-balancing only works on Linux; on other platforms
  // multiple workers still bind but one socket wins. The important part
  // (no EADDRINUSE crash) is covered by the port: 0 test above.
  test.skipIf(!isLinux)(
    "workers listening on a fixed port share it without EADDRINUSE",
    async () => {
      // Previously the primary's RoundRobinHandle bound the port exclusively
      // and the worker's own Bun.listen() on the same port failed with
      // "Failed to listen at ::".
      using dir = tempDir("cluster-net-fixed-port", {
        "index.ts": `
import cluster from "node:cluster";
import net from "node:net";

if (cluster.isPrimary) {
  // Reserve a free port for the workers to share.
  const probe = net.createServer().listen(0, () => {
    const port = probe.address().port;
    probe.close(() => {
      let ready = 0;
      const responders = new Set<string>();
      const workers: import("node:cluster").Worker[] = [];
      const finish = (code: number) => {
        for (const w of workers) w.kill();
        console.log(JSON.stringify({ responders: [...responders].sort() }));
        process.exit(code);
      };
      for (let i = 0; i < 2; i++) {
        const w = cluster.fork({ PORT: String(port) });
        workers.push(w);
        w.on("exit", (code) => {
          if (code !== 0 && code !== null) process.exit(code);
        });
        w.on("message", (msg) => {
          if (msg === "listening") {
            ready++;
            if (ready === 2) {
              // Make enough connections that SO_REUSEPORT hashing is
              // effectively guaranteed to hit both workers (P(all-same)
              // with 64 conns and 2 listeners is ~1e-19).
              let done = 0;
              const total = 64;
              for (let j = 0; j < total; j++) {
                const c = net.connect(port, "127.0.0.1");
                c.on("data", (d) => {
                  responders.add(d.toString().trim());
                  c.end();
                });
                c.on("close", () => {
                  done++;
                  if (done === total) finish(0);
                });
                c.on("error", (err) => {
                  console.error("connect error:", err.message);
                  finish(1);
                });
              }
            }
          }
        });
      }
    });
  });
} else {
  const server = net.createServer((socket) => {
    socket.end("worker-" + cluster.worker!.id);
  });
  server.on("error", (err) => {
    console.error("worker listen error:", err.message);
    process.exit(1);
  });
  server.listen(Number(process.env.PORT), () => {
    process.send!("listening");
  });
}
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout.trim());
      // Both workers should have handled at least one connection.
      expect(result.responders).toEqual(["worker-1", "worker-2"]);
      expect(exitCode).toBe(0);
    },
    20_000,
  );
});
