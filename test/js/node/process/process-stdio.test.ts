import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe(isatty(0) ? true : undefined);
    expect(process.stdin.on("close", function () {})).toBe(process.stdin);
    expect(process.stdin.once("end", function () {})).toBe(process.stdin);
  });

  const files = {
    echo: path.join(import.meta.dir, "process-stdin-echo.js"),
  };

  test("process.stdin - read", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
      env: {
        ...bunEnv,
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED");
  });

  test("process.stdin - resume", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "resume"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: bunEnv,
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe("RESUMED" + lines.join("\n") + "ENDED");
  });

  test("process.stdin - close(#6713)", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "close-event"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED-CLOSE");
  });

  test("process.stdout", () => {
    expect(process.stdout).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stdout.isTTY).toBe((isatty(1) || undefined) as any);
  });

  test("process.stderr", () => {
    expect(process.stderr).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stderr.isTTY).toBe((isatty(2) || undefined) as any);
  });

  test("process.stdout - write", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    expect(stdout?.toString()).toBe(`hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`);
  });

  test("process.stdout - write a lot (string)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
        TEST_STDIO_STRING: "1",
      },
    });

    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test("process.stdout - write a lot (bytes)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });
});

// EPIPE on a broken-pipe stdout: once the reader is gone, both console.log and
// process.stdout.write should surface an 'error' event on process.stdout with
// code EPIPE, and (absent a listener) report one uncaught error and exit 1.
// console.log writes natively to fd 1 and used to swallow the error entirely;
// process.stdout.write went through errorOrDestroy with autoDestroy:false and
// latched after the first emit. https://github.com/oven-sh/bun/issues/7251
describe.concurrent.skipIf(isWindows)("process.stdout/stderr EPIPE after reader closes", () => {
  // Parent spawns a child with piped stdout and immediately destroys the read
  // end; the child waits for that by reading stdin to EOF (the parent closes
  // it), then writes. Pure event-driven: no timers.
  const childBody = (fn: "log" | "write", withListener: boolean) => `
    const seen = [];
    ${
      withListener
        ? `process.stdout.on("error", e => seen.push(e.code + ":" + e.syscall + ":" + e.errno));`
        : `process.on("uncaughtException", e => seen.push("uncaught:" + e.code));`
    }
    process.on("exit", c => process.stderr.write(JSON.stringify({ seen, exit: c }) + "\\n"));
    process.stdin.resume();
    process.stdin.on("end", async () => {
      for (let i = 0; i < 4; i++) {
        ${fn === "write" ? `process.stdout.write("x" + i + "\\n");` : `console.log("x" + i);`}
        await new Promise(r => process.nextTick(r));
        await new Promise(r => process.nextTick(r));
      }
      process.stderr.write("[done]\\n");
      process.exit();
    });`;

  const parentFor = (child: string) => `
    const cp = require("node:child_process");
    const c = cp.spawn(process.execPath, ["-e", ${JSON.stringify(child)}],
      { stdio: ["pipe", "pipe", "inherit"] });
    c.stdout.destroy();
    c.stdin.end();
    c.on("close", code => { console.error("child-exit=" + code); process.exit(0); });`;

  async function run(fn: "log" | "write", withListener: boolean) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parentFor(childBody(fn, withListener))],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("");
    const lines = stderr.trim().split("\n");
    const result = JSON.parse(lines.find(l => l.startsWith("{"))!);
    expect(lines).toContain("[done]");
    expect(lines).toContain("child-exit=" + result.exit);
    expect(exitCode).toBe(0);
    return result as { seen: string[]; exit: number };
  }

  test.each(["log", "write"] as const)("%s with 'error' listener: fires EPIPE per write, exit 0", async fn => {
    const { seen, exit } = await run(fn, true);
    // One 'error' event per write that hit the dead pipe. The first one or two
    // may land before the kernel notices the reader is gone, so require at
    // least 2 (out of 4) rather than exactly 4.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const e of seen) expect(e).toBe("EPIPE:write:-32");
    expect(exit).toBe(0);
  });

  test("console.log without 'error' listener: failure is swallowed", async () => {
    // Node's createWriteErrorHandler adds a noop 'error' listener so a
    // console.log to a dead pipe doesn't crash (test-process-external-stdio-close).
    const { seen, exit } = await run("log", false);
    expect(seen).toEqual([]);
    expect(exit).toBe(0);
  });

  test("process.stdout.write without 'error' listener: one uncaughtException EPIPE", async () => {
    const { seen, exit } = await run("write", false);
    // emitErrorNT's one-shot guard stays latched once nobody is listening, so
    // exactly one uncaughtException is delivered for the whole sequence (not
    // one per write). The test's uncaughtException handler swallows it, hence
    // exit 0.
    expect(seen).toEqual(["uncaught:EPIPE"]);
    expect(exit).toBe(0);
  });

  test("console.log | head with listener can break the loop (#7251)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const cp = require("node:child_process");
         const child = cp.spawn(process.execPath, ["-e", \`
           process.stdout.on("error", e => { process.stderr.write("handler:" + e.code); process.exit(0); });
           (function go() { console.log("line"); setImmediate(go); })();
         \`], { stdio: ["ignore", "pipe", "inherit"] });
         let n = 0;
         child.stdout.on("data", () => { if (++n === 1) child.stdout.destroy(); });
         child.on("close", code => { console.error("child-exit=" + code); process.exit(0); });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("handler:EPIPE");
    expect(stderr).toContain("child-exit=0");
    expect(exitCode).toBe(0);
  });
});
