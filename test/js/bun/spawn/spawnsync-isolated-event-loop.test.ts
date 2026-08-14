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

// spawnSync turns the real event loop inside a strict domain run (POSIX): what
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
        const watcher = fs.watch(${JSON.stringify(String(dir))}, () => note("watch"));
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
        setTimeout(() => { console.log(JSON.stringify([...new Set(log)].sort())); watcher.close(); worker.terminate(); }, 50);
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
      expect(JSON.parse(out)).toEqual(["serve:/block:after", "serve:/second:after", "first:/block", "second:/second"]);
      expect(exitCode).toBe(0);
    },
  );
});
