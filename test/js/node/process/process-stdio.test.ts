import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// Materializing process.stdout dups fd 1 and flips it to O_NONBLOCK. The native
// console writer must not silently drop data on the resulting EAGAIN when the
// pipe is full. Kept outside the concurrent block so the extra spawned children
// don't push the already-slow stdin tests past their default timeout.
describe.skipIf(isWindows)("console.log after process.stdout is materialized on a pipe", () => {
  test("many lines survive a slow reader", async () => {
    const N = 1500;
    const pad = Buffer.alloc(500, "x").toString();
    using dir = tempDir("stdout-nonblock-loss", {
      "child.mjs": `
        if (process.argv[2] === "touch") void process.stdout.writableHighWaterMark;
        const pad = ${JSON.stringify(pad)};
        for (let i = 0; i < ${N}; i++) console.log("O" + i + " " + pad);
      `,
    });
    // A separate `cat` reader starts 400ms late behind a shell fifo, so the
    // 64 KiB pipe fills and write(2) on the now-nonblocking fd 1 returns EAGAIN
    // mid-run. The pipeline's exit status is cat's, not bun's, so the delivered
    // count is what proves the regression is gone.
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        'exec "$0" "$1" touch | { sleep 0.4; exec cat; }',
        bunExe(),
        path.join(String(dir), "child.mjs"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await proc.stdout.text();
    const delivered = stdout.split("\n").filter(l => /^O\d+ x+$/.test(l)).length;
    expect(delivered).toBe(N);
  });

  test("a single 1 MiB line is not truncated", async () => {
    // A single 1 MiB write into even a fast `| wc -c` reader exceeds the 64 KiB
    // pipe, so write(2) on the now-nonblocking fd 1 returns a partial count and
    // then EAGAIN before the reader drains.
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        'exec "$0" -e "void process.stdout.isTTY; console.log(Buffer.alloc(1<<20, 65).toString())" | wc -c',
        bunExe(),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = (await proc.stdout.text()).trim();
    expect(Number(stdout)).toBe((1 << 20) + 1);
  });

  test("parent console.log survives a bun child that touches inherited stdout", async () => {
    // O_NONBLOCK lives on the shared open file description. A bun child with
    // stdio:'inherit' that materializes its process.stdout flips the PARENT's
    // fd 1 too; the parent's console writer must still deliver every line.
    using dir = tempDir("stdout-nonblock-child-inherit", {
      "parent.mjs": `
        const { spawnSync } = require("node:child_process");
        const r = spawnSync(process.execPath, ["-e", 'process.stdout.write("")'],
                            { stdio: ["ignore", "inherit", "ignore"] });
        if (r.error || r.status !== 0) throw new Error("child failed: " + (r.error ?? r.status));
        const pad = Buffer.alloc(190, 120).toString();
        for (let i = 0; i < 20000; i++) console.log("O" + i + " " + pad);
      `,
    });
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", 'exec "$0" "$1" | { sleep 1; wc -l; }', bunExe(), path.join(String(dir), "parent.mjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = (await proc.stdout.text()).trim();
    expect(Number(stdout)).toBe(20000);
  });

  test("console.log survives a raw O_NONBLOCK on fd 1 (isolates the writer)", async () => {
    // Bun.file(1).writer() goes through FileSink.setup (dup + O_NONBLOCK) but is
    // NOT the process.stdout getter path, so ForceFileSinkToBeSynchronous never
    // clears the flag. This isolates fd_write_all_quiet's EAGAIN handling.
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        'exec "$0" -e "void Bun.file(1).writer(); console.log(Buffer.alloc(1<<20, 65).toString())" | { sleep 0.4; exec wc -c; }',
        bunExe(),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = (await proc.stdout.text()).trim();
    expect(Number(stdout)).toBe((1 << 20) + 1);
  });
});
