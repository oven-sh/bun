import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import fs from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/14054
(isWindows ? describe.skip : describe.concurrent)("Bun.write with a pipe source", () => {
  const resolved = (expr: string) => `process.stderr.write(String(await ${expr}))`;
  const outcome = (expr: string) =>
    `try { process.stderr.write(JSON.stringify({ resolved: await ${expr} })); } catch (e) { process.stderr.write(JSON.stringify({ code: e.code, syscall: e.syscall })); }`;
  const contentOf = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

  // sh gives the child a kernel pipe on fd 0. Bun.spawn's "pipe" is a socketpair.
  async function sh(command: string, script: string, env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", command],
      env: { ...bunEnv, BUN: bunExe(), SCRIPT: script, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.each([
    "Bun.write(Bun.file(process.env.OUT), Bun.stdin)",
    "Bun.file(process.env.OUT).write(Bun.stdin)",
    "Bun.write(process.env.OUT, Bun.file(0))",
    'Bun.write(process.env.OUT, Bun.file("/dev/stdin"))',
    "Bun.write(process.env.OUT, new Response(Bun.stdin))",
    "Bun.write(process.env.OUT, [Bun.stdin])",
    "Bun.write(Bun.file(process.env.OUT), await new Response(Bun.stdin.stream()).blob())",
  ])("%s copies the pipe into the file", async expr => {
    using dir = tempDir("bun-write-pipe-source", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await sh(`printf 'hello world\\n' | "$BUN" -e "$SCRIPT"`, resolved(expr), {
      OUT: out,
    });

    expect({ stdout, stderr, content: contentOf(out) }).toEqual({
      stdout: "",
      stderr: "12",
      content: "hello world\n",
    });
    expect(exitCode).toBe(0);
  });

  it("copies from a FIFO path", async () => {
    using dir = tempDir("bun-write-fifo-source", {});
    const fifo = join(String(dir), "fifo");
    const out = join(String(dir), "out.txt");
    expect(Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);
    await using writer = Bun.spawn({
      cmd: ["sh", "-c", `printf 'hello world\\n' > "$1"`, "sh", fifo],
      stdio: ["ignore", "ignore", "inherit"],
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", resolved("Bun.write(process.env.OUT, Bun.file(process.env.FIFO))")],
      env: { ...bunEnv, OUT: out, FIFO: fifo },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, content: contentOf(out) }).toEqual({
      stdout: "",
      stderr: "12",
      content: "hello world\n",
    });
    expect(exitCode).toBe(0);
    expect(await writer.exited).toBe(0);
  });

  it("copies 1 MiB in order", async () => {
    const bytes = Buffer.alloc(1024 * 1024, Buffer.from(Array.from({ length: 251 }, (_, i) => i)));
    using dir = tempDir("bun-write-pipe-large", {});
    const src = join(String(dir), "src.bin");
    const out = join(String(dir), "out.bin");
    fs.writeFileSync(src, bytes);
    const { stdout, stderr, exitCode } = await sh(
      `cat "$SRC" | "$BUN" -e "$SCRIPT"`,
      resolved("Bun.write(process.env.OUT, Bun.stdin)"),
      { OUT: out, SRC: src },
    );

    expect({ stdout, stderr, same: fs.existsSync(out) && fs.readFileSync(out).equals(bytes) }).toEqual({
      stdout: "",
      stderr: String(bytes.length),
      same: true,
    });
    expect(exitCode).toBe(0);
  });

  // The /dev/null row fails before the fix on macOS only: Linux already copies a character device.
  it.each([
    ["a pipe whose writer closes without writing", `true | "$BUN" -e "$SCRIPT"`],
    ["/dev/null", `"$BUN" -e "$SCRIPT" < /dev/null`],
  ])("resolves 0 and creates the file from %s", async (_, command) => {
    using dir = tempDir("bun-write-pipe-empty", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await sh(command, resolved("Bun.write(process.env.OUT, Bun.stdin)"), {
      OUT: out,
    });

    expect({ stdout, stderr, content: contentOf(out) }).toEqual({ stdout: "", stderr: "0", content: "" });
    expect(exitCode).toBe(0);
  });

  it("copies to EOF after exists() resolved the destination size to 0", async () => {
    using dir = tempDir("bun-write-pipe-exists-first", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await sh(
      `printf 'hello world\\n' | "$BUN" -e "$SCRIPT"`,
      `const file = Bun.file(process.env.OUT); await file.exists(); ${resolved("Bun.write(file, Bun.stdin)")}`,
      { OUT: out },
    );

    expect({ stdout, stderr, content: contentOf(out) }).toEqual({
      stdout: "",
      stderr: "12",
      content: "hello world\n",
    });
    expect(exitCode).toBe(0);
  });

  it("stops at the end of a destination slice and leaves the rest in the pipe", async () => {
    using dir = tempDir("bun-write-pipe-window", {});
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await sh(
      `printf 'hello world\\n' | { "$BUN" -e "$SCRIPT"; wc -c; }`,
      resolved("Bun.write(Bun.file(process.env.OUT).slice(0, 5), Bun.stdin)"),
      { OUT: out },
    );

    expect({ leftInPipe: stdout.trim(), stderr, content: contentOf(out) }).toEqual({
      leftInPipe: "7",
      stderr: "5",
      content: "hello",
    });
    expect(exitCode).toBe(0);
  });

  it("replaces an existing file and applies the mode option", async () => {
    using dir = tempDir("bun-write-pipe-mode", { "out.txt": "previous contents, longer than the new ones" });
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await sh(
      `printf 'hello world\\n' | "$BUN" -e "$SCRIPT"`,
      resolved("Bun.write(process.env.OUT, Bun.stdin, { mode: 0o600 })"),
      { OUT: out },
    );

    expect({ stdout, stderr, content: contentOf(out), mode: fs.statSync(out).mode & 0o777 }).toEqual({
      stdout: "",
      stderr: "12",
      content: "hello world\n",
      mode: 0o600,
    });
    expect(exitCode).toBe(0);
  });

  it.each([
    ["a stdout redirected with >", `> "$OUT"`, "", "hello world\n"],
    ["a stdout redirected with >>, after the existing bytes", `>> "$OUT"`, "AAAAAAAAAA", "AAAAAAAAAAhello world\n"],
    ["/dev/null", "> /dev/null", "untouched", "untouched"],
  ])("copies into %s", async (_, redirect, before, after) => {
    using dir = tempDir("bun-write-pipe-fd-dest", { "out.txt": before });
    const out = join(String(dir), "out.txt");
    const { stdout, stderr, exitCode } = await sh(
      `printf 'hello world\\n' | "$BUN" -e "$SCRIPT" ${redirect}`,
      resolved("Bun.write(Bun.stdout, Bun.stdin)"),
      { OUT: out },
    );

    expect({ stdout, stderr, content: contentOf(out) }).toEqual({ stdout: "", stderr: "12", content: after });
    expect(exitCode).toBe(0);
  });

  it("copies into a socket", async () => {
    const { stdout, stderr, exitCode } = await sh(
      `printf 'hello world\\n' | "$BUN" -e "$SCRIPT"`,
      resolved("Bun.write(Bun.stdout, Bun.stdin)"),
      {},
    );

    expect({ stdout, stderr }).toEqual({ stdout: "hello world\n", stderr: "12" });
    expect(exitCode).toBe(0);
  });

  it("rejects with the read error and does not apply the mode option", async () => {
    using dir = tempDir("bun-write-pipe-read-error", { "out.txt": "existing" });
    const out = join(String(dir), "out.txt");
    fs.chmodSync(out, 0o644);
    // fd 1 is the write end of the pipe to cat, so a read from it fails.
    const { stderr, exitCode } = await sh(
      `"$BUN" -e "$SCRIPT" | cat`,
      outcome("Bun.write(process.env.OUT, Bun.file(1), { mode: 0o600 })"),
      { OUT: out },
    );

    expect({ stderr, mode: fs.statSync(out).mode & 0o777 }).toEqual({
      stderr: '{"code":"EBADF","syscall":"read"}',
      mode: 0o644,
    });
    expect(exitCode).toBe(0);
  });

  describe.skipIf(!isLinux)("on Linux", () => {
    it.each([
      ['Bun.write("/dev/full", Bun.stdin)', ""],
      ["Bun.write(Bun.stdout, Bun.stdin)", "> /dev/full"],
    ])("rejects with the write error: %s %s", async (expr, redirect) => {
      const { stdout, stderr, exitCode } = await sh(
        `printf 'hello world\\n' | "$BUN" -e "$SCRIPT" ${redirect}`,
        outcome(expr),
        {},
      );

      expect({ stdout, stderr }).toEqual({ stdout: "", stderr: '{"code":"ENOSPC","syscall":"write"}' });
      expect(exitCode).toBe(0);
    });

    it("copies into a terminal", async () => {
      using dir = tempDir("bun-write-pipe-tty-dest", {});
      const err = join(String(dir), "err.txt");
      const decoder = new TextDecoder();
      const closed = Promise.withResolvers<void>();
      let output = "";
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", `printf 'hello world\\n' | "$BUN" -e "$SCRIPT" 2> "$ERR"`],
        env: { ...bunEnv, BUN: bunExe(), SCRIPT: resolved("Bun.write(Bun.stdout, Bun.stdin)"), ERR: err },
        terminal: {
          data(_terminal, chunk) {
            output += decoder.decode(chunk, { stream: true });
          },
          exit() {
            closed.resolve();
          },
        },
      });
      const exitCode = await proc.exited;
      await closed.promise;

      expect({ output, stderr: contentOf(err) }).toEqual({ output: "hello world\r\n", stderr: "12" });
      expect(exitCode).toBe(0);
    });

    // An fd with no file type has no end to read to: Bun's own epoll fd is one.
    it("still refuses a source with no file type", async () => {
      using dir = tempDir("bun-write-typeless-source", {});
      const script = `
        const fs = require("node:fs");
        const isEpoll = fd => {
          try {
            return fs.readlinkSync("/proc/self/fd/" + fd) === "anon_inode:[eventpoll]";
          } catch {
            return false;
          }
        };
        const fd = fs.readdirSync("/proc/self/fd").map(Number).find(isEpoll);
        try {
          process.stderr.write(JSON.stringify({ resolved: await Bun.write(process.env.OUT, Bun.file(fd)) }));
        } catch (e) {
          process.stderr.write(JSON.stringify({ errno: e.errno, syscall: e.syscall }));
        }
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, OUT: join(String(dir), "out.txt") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, stderr }).toEqual({ stdout: "", stderr: '{"errno":95,"syscall":"fstat"}' });
      expect(exitCode).toBe(0);
    });
  });
});
