import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, joinP, tempDir, tempDirWithFiles } from "harness";

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

// https://github.com/oven-sh/bun/issues/13611
// SO_REUSEPORT does not apply to AF_UNIX; every worker must adopt the same
// listen descriptor from the primary instead of binding independently.
test.skipIf(isWindows)(
  "Bun.serve({ unix }) shares one listen socket across cluster workers",
  async () => {
    using dir = tempDir("bun-serve-cluster-unix", {
      "index.ts": `
      import cluster from "node:cluster";
      import net from "node:net";
      import path from "node:path";
      const SOCK = path.join(process.cwd(), "serve.sock");
      const WORKERS = 3;
      async function request(): Promise<string> {
        return new Promise(r => {
          const c = net.connect(SOCK);
          let b = "";
          c.on("data", d => b += d);
          c.on("close", () => r(b.split("\\r\\n\\r\\n")[1] ?? ""));
          c.on("error", () => r(""));
          c.write("GET / HTTP/1.0\\r\\nHost: x\\r\\n\\r\\n");
        });
      }
      if (cluster.isPrimary) {
        let ready = 0;
        const workers: any[] = [];
        for (let i = 0; i < WORKERS; i++) {
          const w = cluster.fork({ WORKER_NUM: String(i) });
          workers.push(w);
          w.on("message", m => { if (m === "ready" && ++ready === WORKERS) go(); });
          w.on("exit", (code, sig) => {
            if (code !== 0 && sig !== "SIGTERM") {
              console.error("worker " + i + " exited " + code + " signal " + sig);
              process.exit(1);
            }
          });
        }
        async function go() {
          // Every worker returned from Bun.serve without throwing: on an
          // unpatched build 2 of 3 workers EADDRINUSE and exit before this
          // prints.
          console.log("listening=" + WORKERS);
          // accept() on a shared fd is kernel-scheduled across the epoll set,
          // not round-robin; keep going until at least two workers have
          // answered. Without the fix this never passes because only one
          // worker ever bound.
          const seen = new Set<string>();
          for (let i = 0; i < 100 && seen.size < 2; i++) {
            const body = await request();
            if (body) seen.add(body);
          }
          console.log("distinct=" + seen.size);
          // One worker stopping must not unlink the primary-owned socket file
          // or break the remaining workers' accepts.
          const stopped = await new Promise<string>(r => {
            workers[0].once("message", r);
            workers[0].send("stop");
          });
          console.log("sock-after-stop=" + require("fs").existsSync(SOCK));
          let responder = "";
          for (let i = 0; i < 100 && (!responder || responder === stopped); i++)
            responder = await request();
          console.log("after-stop-responder=" + (responder && responder !== stopped));
          for (const w of workers) w.kill();
          process.exit(seen.size >= 2 ? 0 : 1);
        }
      } else {
        const id = process.env.WORKER_NUM;
        const server = Bun.serve({
          unix: SOCK,
          reusePort: true,
          fetch() { return new Response("worker-" + id); },
        });
        process.on("message", m => {
          if (m !== "stop") return;
          server.stop(true);
          process.send!("worker-" + id);
        });
        process.send!("ready");
      }
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("EADDRINUSE");
    expect(stdout).toContain("listening=3");
    expect(stdout).toContain("distinct=2");
    expect(stdout).toContain("sock-after-stop=true");
    expect(stdout).toContain("after-stop-responder=true");
    expect(exitCode).toBe(0);
  },
  20_000,
);

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
