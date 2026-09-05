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

// Materializing process.stdout / process.stderr puts O_NONBLOCK on the shared
// open file description of fd 1 / fd 2. The native console writer behind
// console.log / console.error must then retry on EAGAIN instead of dropping the
// unwritten tail. A single 1 MiB write is larger than any pipe buffer, so the
// first write(2) is always short and the next one always sees EAGAIN: the
// unfixed binary delivers exactly one pipe buffer no matter how fast the reader
// is, which keeps these deterministic without a sleeping reader. Kept outside the
// concurrent block above so the extra children don't push the stdin tests past
// their timeout.
describe.skipIf(isWindows)("console output is not truncated once the stdio fd is nonblocking", () => {
  const ONE_MIB_LINE = (1 << 20) + 1;

  test("console.log after touching process.stdout", async () => {
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
    expect(Number((await proc.stdout.text()).trim())).toBe(ONE_MIB_LINE);
  });

  test("console.error after touching process.stderr", async () => {
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        'exec "$0" -e "void process.stderr.isTTY; console.error(Buffer.alloc(1<<20, 66).toString())" 2>&1 >/dev/null | wc -c',
        bunExe(),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    expect(Number((await proc.stdout.text()).trim())).toBe(ONE_MIB_LINE);
  });

  test("console.log in a parent after a bun child touched the inherited stdout", async () => {
    // The flag lives on the open file description, so a child with
    // stdio: 'inherit' that touches its process.stdout flips the parent's fd 1
    // too, even though the parent never touched its own stream.
    using dir = tempDir("stdout-nonblock-inherited", {
      "parent.ts": `
        const r = Bun.spawnSync({
          cmd: [process.execPath, "-e", 'process.stdout.write("")'],
          stdout: "inherit",
        });
        if (!r.success) throw new Error("child failed: " + r.exitCode);
        console.log(Buffer.alloc(1 << 20, 65).toString());
      `,
    });
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", 'exec "$0" "$1" | wc -c', bunExe(), path.join(String(dir), "parent.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    expect(Number((await proc.stdout.text()).trim())).toBe(ONE_MIB_LINE);
  });

  test("process.stdout.write to a pipe stays asynchronous", async () => {
    // Pins the contract the console-writer fix must not disturb: like node, a
    // write larger than the pipe returns false immediately and emits 'drain'
    // once the reader catches up, rather than blocking the JS thread.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const ret = process.stdout.write(Buffer.alloc(1 << 20, 65));
          process.stdout.once("drain", () => {
            process.stderr.write(JSON.stringify({ ret, drained: true }));
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.bytes(), proc.stderr.text()]);
    expect(stdout.byteLength).toBe(1 << 20);
    expect(JSON.parse(stderr)).toEqual({ ret: false, drained: true });
  });
});
