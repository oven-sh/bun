import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

describe.concurrent("spawnSync isolated event loop", () => {
  test("JavaScript timers should not fire during spawnSync", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let timerFired = false;

        // Set a timer that should NOT fire during spawnSync
        const interval = setInterval(() => {
          timerFired = true;
          console.log("TIMER_FIRED");
          process.exit(1);
        }, 1);

        // Run a subprocess synchronously
        const result = Bun.spawnSync({
          cmd: ["${bunExe()}", "-e", "Bun.sleepSync(16)"],
          env: process.env,
        });

        clearInterval(interval);

        console.log("SUCCESS: Timer did not fire during spawnSync");
        process.exit(0);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("SUCCESS");
    expect(stdout).not.toContain("TIMER_FIRED");
    expect(stdout).not.toContain("FAIL");
    expect(exitCode).toBe(0);
  });

  test("microtasks should not drain during spawnSync", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        queueMicrotask(() => {
          console.log("MICROTASK_FIRED");
          process.exit(1);  
        });

        // Run a subprocess synchronously
        const result = Bun.spawnSync({
          cmd: ["${bunExe()}", "-e", "42"],
          env: process.env,
        });

        console.log("SUCCESS: Timer did not fire during spawnSync");
        process.exit(0);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("SUCCESS");
    expect(stdout).not.toContain("MICROTASK_FIRED");
    expect(stdout).not.toContain("FAIL");
    expect(exitCode).toBe(0);
  });

  test("stdin/stdout from main process should not be affected by spawnSync", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Write to stdout before spawnSync
        console.log("BEFORE");

        // Run a subprocess synchronously
        const result = Bun.spawnSync({
          cmd: ["echo", "SUBPROCESS"],
          env: process.env,
        });

        // Write to stdout after spawnSync
        console.log("AFTER");

        // Verify subprocess output
        const subprocessOut = new TextDecoder().decode(result.stdout);
        if (!subprocessOut.includes("SUBPROCESS")) {
          console.log("FAIL: Subprocess output missing");
          process.exit(1);
        }

        console.log("SUCCESS");
        process.exit(0);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("BEFORE");
    expect(stdout).toContain("AFTER");
    expect(stdout).toContain("SUCCESS");
    expect(exitCode).toBe(0);
  });

  test("multiple spawnSync calls should each use isolated event loop", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let timerCount = 0;

        // Set timers that should NOT fire during spawnSync
        setTimeout(() => { timerCount++; }, 10);
        setTimeout(() => { timerCount++; }, 20);
        setTimeout(() => { timerCount++; }, 30);

        // Run multiple subprocesses synchronously
        for (let i = 0; i < 3; i++) {
          const result = Bun.spawnSync({
            cmd: ["${bunExe()}", "-e", "Bun.sleepSync(50)"],
          });

          if (timerCount > 0) {
            console.log(\`FAIL: Timer fired during spawnSync iteration \${i}\`);
            process.exit(1);
          }
        }

        console.log("SUCCESS: No timers fired during any spawnSync call");
        process.exit();
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("SUCCESS");
    expect(stdout).not.toContain("FAIL");
    expect(exitCode).toBe(0);
  });
});

// spawnSync turns the real event loop inside a native-only domain run (POSIX): what
// predates the call is held until it returns and then delivered in order.
describe.concurrent("spawnSync on the real loop holds everything that predates it", () => {
  /** Run `script` in a child and return the JSON it prints last. */
  async function run(script: string, env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out: stdout.trim(), stderr, exitCode };
  }
  // Inside the -e scripts: a child that blocks until `marker` exists, so "during
  // spawnSync" is a condition, not a duration.
  const waitChild = (marker: string) =>
    `[process.execPath, "-e", "const fs=require('fs'); while(!fs.existsSync(" + JSON.stringify(${JSON.stringify(marker)}) + ")) Bun.sleepSync(2)"]`;

  test.skipIf(process.platform === "win32")(
    "timers, immediates, microtasks and nextTicks scheduled before spawnSync run after it, in their usual order",
    async () => {
      using dir = tempDir("spawnsync-held", {});
      const marker = join(String(dir), "m");
      const { out, exitCode } = await run(`
        const log = [];
        let during = true;
        const note = what => () => log.push(what + (during ? ":during" : ":after"));
        setTimeout(note("timeout"), 0);
        setImmediate(note("immediate"));
        queueMicrotask(note("microtask"));
        process.nextTick(note("nexttick"));
        Promise.resolve().then(note("then"));
        // The 0ms timer is overdue long before the marker appears.
        setTimeout(() => {}, 0); Bun.sleepSync(5);
        require("fs").writeFileSync(${JSON.stringify(marker)} + ".go", "");
        const r = Bun.spawnSync({ cmd: [process.execPath, "-e", "require('fs').writeFileSync(" + JSON.stringify(${JSON.stringify(marker)}) + ", '')"] });
        during = false;
        log.push("returned:" + r.exitCode);
        setTimeout(() => console.log(JSON.stringify(log)), 10);
      `);
      expect(JSON.parse(out)).toEqual([
        "returned:0",
        "nexttick:after",
        "microtask:after",
        "then:after",
        "immediate:after",
        "timeout:after",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(process.platform === "win32")(
    "another child's output and exit that arrive during spawnSync are delivered after it",
    async () => {
      using dir = tempDir("spawnsync-outer-child", {});
      const marker = join(String(dir), "m");
      const { out, stderr, exitCode } = await run(`
        const fs = require("fs");
        const log = [];
        let during = false;
        const outer = Bun.spawn({
          // Writes and exits while the parent is inside spawnSync, then releases it.
          cmd: [process.execPath, "-e", "const fs=require('fs'); while(!fs.existsSync(" + JSON.stringify(${JSON.stringify(marker)} + ".in") + ")) Bun.sleepSync(2); fs.writeSync(1, 'outer'); fs.writeFileSync(" + JSON.stringify(${JSON.stringify(marker)}) + ", '')"],
          stdout: "pipe",
          onExit: () => log.push("outer-exit:" + (during ? "during" : "after")),
        });
        outer.stdout.text().then(t => log.push("outer-stdout:" + t + ":" + (during ? "during" : "after")));
        during = true;
        fs.writeFileSync(${JSON.stringify(marker)} + ".in", "");
        Bun.spawnSync({ cmd: ${waitChild(marker)} });
        during = false;
        log.push("returned");
        outer.exited.then(() => setImmediate(() => console.log(JSON.stringify(log.sort()))));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(out)).toEqual(["outer-exit:after", "outer-stdout:outer:after", "returned"]);
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(process.platform === "win32")(
    "fs.watch, fs.readFile, zlib, AbortSignal.timeout and Worker callbacks that complete during spawnSync run after it",
    async () => {
      using dir = tempDir("spawnsync-callbacks", {});
      const marker = join(String(dir), "m");
      const { out, exitCode } = await run(`
        const fs = require("fs");
        const log = [];
        let during = false;
        const note = what => log.push(what + ":" + (during ? "during" : "after"));
        let watched = false;
        const watcher = fs.watch(${JSON.stringify(String(dir))}, () => { if (!watched) { watched = true; note("watch"); } });
        fs.readFile(__filename, () => note("readFile"));
        require("zlib").gzip("abc", () => note("gzip"));
        const signal = AbortSignal.timeout(1);
        signal.onabort = () => note("abort");
        const worker = new Worker("data:text/javascript," + encodeURIComponent("postMessage('hi')"));
        worker.onmessage = () => note("worker-message");
        during = true;
        // The child touches the watched dir, waits for the timeout to be overdue, then releases us.
        Bun.spawnSync({ cmd: [process.execPath, "-e", "const fs=require('fs'); fs.writeFileSync(" + JSON.stringify(${JSON.stringify(join(String(dir), "touched"))}) + ", ''); Bun.sleepSync(20);"] });
        during = false;
        log.push("returned");
        setTimeout(() => { console.log(JSON.stringify(log.sort())); watcher.close(); worker.terminate(); }, 50);
      `);
      expect(JSON.parse(out)).toEqual([
        "abort:after",
        "gzip:after",
        "readFile:after",
        "returned",
        "watch:after",
        "worker-message:after",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(process.platform === "win32")(
    "a response's buffered write flushed while spawnSync waits does not pull that connection's handlers into it",
    async () => {
      // res.write() registers an auto-flush that runs at the next checkpoint — i.e.
      // inside execSync. That flush is outer housekeeping, not the child's doing:
      // the request's later 'data'/'end' events still wait for execSync to return.
      using dir = tempDir("spawnsync-http", {
        "server.js": `
          const http = require("node:http");
          const { execSync } = require("node:child_process");
          const log = [];
          let during = false;
          const server = http.createServer((req, res) => {
            req.on("data", d => {
              log.push("data:" + d + ":" + (during ? "during" : "after"));
              if (String(d) === "first") {
                res.write("partial");
                during = true;
                execSync("sleep 0.2");
                during = false;
                log.push("returned");
              }
            });
            req.on("end", () => { res.end(); server.close(); console.log(JSON.stringify(log)); });
          });
          server.listen(0, () => {
            // A client in this process would have its own writes parked; drive it from a child.
            Bun.spawn([process.execPath, "client.js", String(server.address().port)], { stdio: ["ignore", "inherit", "inherit"] });
          });
        `,
        "client.js": `
          const s = require("node:net").connect(Number(process.argv[2]), "127.0.0.1", () => {
            s.write("POST / HTTP/1.1\\r\\nHost: a\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n5\\r\\nfirst\\r\\n");
            setTimeout(() => s.write("6\\r\\nsecond\\r\\n"), 50);
            setTimeout(() => s.write("0\\r\\n\\r\\n"), 100);
          });
          s.on("data", () => {});
          s.on("close", () => process.exit(0));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "server.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [out, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(JSON.parse(out.trim())).toEqual(["data:first:after", "returned", "data:second:after"]);
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(process.platform === "win32")(
    "a UDP message that arrives during spawnSync is delivered after it",
    async () => {
      const { out, exitCode } = await run(`
      const dgram = require("node:dgram");
      const log = [];
      let during = false;
      const sock = dgram.createSocket("udp4");
      sock.on("message", m => { log.push("message:" + m + ":" + (during ? "during" : "after")); sock.close(); console.log(JSON.stringify(log)); });
      sock.bind(0, "127.0.0.1", () => {
        const { port } = sock.address();
        during = true;
        // The child sends while we are blocked, then lingers so the datagram is surely queued.
        Bun.spawnSync({ cmd: [process.execPath, "-e", "const d = require('node:dgram').createSocket('udp4'); d.send('hi', " + port + ", '127.0.0.1', () => { d.close(); Bun.sleepSync(100); });"] });
        during = false;
        log.push("returned");
      });
    `);
      expect(JSON.parse(out)).toEqual(["returned", "message:hi:after"]);
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(process.platform === "win32")("promise jobs keep FIFO order across spawnSync", async () => {
    const { out, exitCode } = await run(`
      const log = [];
      (async () => { await null; log.push("a1"); await null; log.push("a2"); })();
      (async () => { await 0; log.push("b1"); await 0; log.push("b2"); })();
      Promise.all([1, 2]).then(() => log.push("all"));
      Bun.spawnSync({ cmd: [process.execPath, "-e", "1"] });
      setTimeout(() => console.log(JSON.stringify(log)));
    `);
    expect(JSON.parse(out)).toEqual(["a1", "b1", "a2", "b2", "all"]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(process.platform === "win32")(
    "a rejection handled right after spawnSync is not reported as unhandled during it",
    async () => {
      const { out, stderr, exitCode } = await run(`
        process.on("unhandledRejection", () => { console.log("UNHANDLED"); process.exit(1); });
        const p = (async () => { throw new Error("handled later"); })();
        Bun.spawnSync({ cmd: [process.execPath, "-e", "1"] });
        p.catch(() => console.log("handled"));
      `);
      expect(out).toBe("handled");
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(process.platform === "win32")(
    "a request that arrives during spawnSync inside a server handler is served after it",
    async () => {
      const { out, exitCode } = await run(`
        const log = [];
        let during = false;
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            const path = new URL(req.url).pathname;
            log.push("serve:" + path + ":" + (during ? "during" : "after"));
            if (path === "/block") {
              // A second connection is opened (by the fetch thread) while we block;
              // the listen socket keeps it in the backlog until spawnSync returns.
              second = fetch("http://127.0.0.1:" + server.port + "/second");
              during = true;
              Bun.spawnSync({ cmd: [process.execPath, "-e", "Bun.sleepSync(30)"] });
              during = false;
            }
            return new Response(path);
          },
        });
        let second;
        const first = await fetch("http://127.0.0.1:" + server.port + "/block").then(r => r.text());
        log.push("first:" + first);
        log.push("second:" + (await second.then(r => r.text())));
        server.stop(true);
        console.log(JSON.stringify(log));
      `);
      // Whether the client sees the first response before or after the server
      // accepts the second connection is a race between the HTTP thread and the
      // next poll; what matters is that /second was served after spawnSync.
      const log = JSON.parse(out);
      expect(log[0]).toBe("serve:/block:after");
      expect(log.slice(1).sort()).toEqual(["first:/block", "second:/second", "serve:/second:after"]);
      expect(exitCode).toBe(0);
    },
  );
});
