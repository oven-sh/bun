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

// process.stdout/stderr must leave fd 1/2 blocking: O_NONBLOCK lives on the open file description, which children and the
// native console writer share. Writes stay asynchronous through per-call nonblocking I/O instead.
describe.concurrent.skipIf(isWindows)("process.stdout/stderr do not set O_NONBLOCK on fd 1/2", () => {
  const probe = path.join(import.meta.dir, "fd-nonblock-fixture.js");

  test("fd 1 and 2 are still blocking in an inherit child after the parent wrote to process.stdout/stderr", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write("out\\n");
         process.stderr.write("err\\n");
         const r = Bun.spawnSync([process.execPath, ${JSON.stringify(probe)}, "1", "2"], { stdio: ["inherit", "inherit", "inherit"] });
         process.exit(r.exitCode);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("err\n");
    expect(stdout).toBe("out\n1:blocking 2:blocking\n");
    expect(exitCode).toBe(0);
  });

  test("a plain tool with inherited stdout can write more than a pipe holds after process.stdout was used", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write("start\\n");
         const r = Bun.spawnSync(["head", "-c", "1000000", "/dev/zero"], { stdio: ["inherit", "inherit", "inherit"] });
         process.stderr.write("rc=" + r.exitCode + "\\n");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("rc=0\n");
    expect(stdout.byteLength).toBe("start\n".length + 1000000);
    expect(exitCode).toBe(0);
  });

  // A single 1 MiB line is larger than any pipe buffer, so with O_NONBLOCK set the console writer's second write(2)
  // hit EAGAIN and the rest was dropped regardless of how fast the reader is.
  test("console.log is not truncated after process.stdout was used", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "-e", `void process.stdout.isTTY; console.log(Buffer.alloc(1 << 20, "A").toString());`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
    expect(stdout.byteLength).toBe((1 << 20) + 1);
    expect(exitCode).toBe(0);
  });

  test("console.error is not truncated after process.stderr was used", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "-e", `void process.stderr.isTTY; console.error(Buffer.alloc(1 << 20, "B").toString());`],
      env: bunEnv,
      stdout: "inherit",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.bytes(), proc.exited]);
    expect(stderr.byteLength).toBe((1 << 20) + 1);
    expect(exitCode).toBe(0);
  });

  test("process.stdout.write to a full pipe still returns false and emits drain", async () => {
    // lazy: nothing reads the child's stdout until we ask, so the 1 MiB write must hit a full pipe.
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ret = process.stdout.write(Buffer.alloc(1 << 20, "A"));
         process.stderr.write(JSON.stringify({ ret }) + "\\n");
         process.stdout.once("drain", () => process.stderr.write(JSON.stringify({ drained: true }) + "\\n"));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      lazy: true,
    });
    const stderr = proc.stderr.getReader();
    let first = "";
    while (!first.includes("\n")) {
      const { value, done } = await stderr.read();
      if (done) break;
      first += Buffer.from(value).toString();
    }
    expect(JSON.parse(first.split("\n")[0])).toEqual({ ret: false });
    const [stdout, rest, exitCode] = await Promise.all([
      proc.stdout.bytes(),
      (async () => {
        let out = first.slice(first.indexOf("\n") + 1);
        while (true) {
          const { value, done } = await stderr.read();
          if (done) return out;
          out += Buffer.from(value).toString();
        }
      })(),
      proc.exited,
    ]);
    expect(stdout.byteLength).toBe(1 << 20);
    expect(JSON.parse(rest.trim())).toEqual({ drained: true });
    expect(exitCode).toBe(0);
  });
  // Bun.spawn's "pipe" is a socketpair; these go through sh so fd 1 is a real pipe(2) and the pipe write path runs.
  test("console.log and process.stdout.write are not truncated over a real pipe", async () => {
    await using proc = spawn({
      cmd: [
        "sh",
        "-c",
        `"$0" -e 'void process.stdout.isTTY; console.log(Buffer.alloc(1 << 20, "A").toString()); process.stdout.write(Buffer.alloc(1 << 20, "B"));' | cat`,
        bunExe(),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.byteLength).toBe((1 << 20) + 1 + (1 << 20));
    expect(exitCode).toBe(0);
  });

  test("process.stdout.write to a full real pipe returns false, emits drain, and fd 1 stays blocking", async () => {
    // The reader only starts draining on SIGUSR1, so the writer's 1 MiB must hit a full pipe first.
    const reader = `process.on("SIGUSR1", async () => { for await (const c of Bun.stdin.stream()) require("fs").writeSync(1, c); process.exit(0); });
      setInterval(() => {}, 1 << 30);
      require("fs").writeSync(2, JSON.stringify({ reader: process.pid }) + "\\n");`;
    const writer = `const ret = process.stdout.write(Buffer.alloc(1 << 20, "A"));
      require("fs").writeSync(2, JSON.stringify({ ret }) + "\\n");
      process.stdout.once("drain", () => {
        const r = Bun.spawnSync([process.execPath, ${JSON.stringify(probe)}, "1"], { stdio: ["inherit", "inherit", "pipe"], env: { ...process.env, PROBE_OUT_FD: "2" } });
        require("fs").writeSync(2, JSON.stringify({ drained: true, probe: r.stderr.toString().trim() }) + "\\n");
      });`;
    await using proc = spawn({
      cmd: ["sh", "-c", `"$0" -e "$1" | "$0" -e "$2"`, bunExe(), writer, reader],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines: any[] = [];
    let buf = "";
    const stderr = proc.stderr.getReader();
    const next = async () => {
      while (true) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const v = JSON.parse(line);
          lines.push(v);
          return v;
        }
        const { value, done } = await stderr.read();
        if (done) throw new Error("stderr closed early: " + JSON.stringify(lines) + " " + JSON.stringify(buf));
        buf += Buffer.from(value).toString();
      }
    };
    let readerPid: number | undefined, ret: boolean | undefined;
    while (readerPid === undefined || ret === undefined) {
      const v = await next();
      if ("reader" in v) readerPid = v.reader;
      if ("ret" in v) ret = v.ret;
    }
    expect(ret).toBe(false);
    process.kill(readerPid!, "SIGUSR1");
    const drained = await next();
    expect(drained).toEqual({ drained: true, probe: "1:blocking" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
    expect(stdout.byteLength).toBe(1 << 20);
    expect(exitCode).toBe(0);
  });
});
