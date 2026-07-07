import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows } from "harness";
import fs from "node:fs";

// Cross-platform Bun.Terminal + Bun.spawn integration tests that don't rely
// on POSIX-only behaviour (termios echo, SIGWINCH, cat/echo binaries). The
// remaining POSIX-specific coverage lives in terminal.test.ts.
describe("Bun.Terminal subprocess integration", () => {
  test("constructor creates a PTY", async () => {
    await using terminal = new Bun.Terminal({});
    expect(terminal.closed).toBe(false);
  });

  test("constructor with custom size", async () => {
    await using terminal = new Bun.Terminal({ cols: 120, rows: 40 });
    expect(terminal.closed).toBe(false);
  });

  test("write returns byte count", async () => {
    await using terminal = new Bun.Terminal({});
    expect(terminal.write("hello")).toBe(5);
    expect(terminal.write("")).toBe(0);
    expect(terminal.write(new TextEncoder().encode("abc"))).toBe(3);
  });

  test("resize succeeds", async () => {
    await using terminal = new Bun.Terminal({ cols: 80, rows: 24 });
    expect(() => terminal.resize(100, 30)).not.toThrow();
    expect(() => terminal.resize(40, 10)).not.toThrow();
  });

  test("close marks terminal closed and write throws", () => {
    const terminal = new Bun.Terminal({});
    terminal.close();
    expect(terminal.closed).toBe(true);
    expect(() => terminal.write("x")).toThrow();
    expect(() => terminal.resize(10, 10)).toThrow();
  });

  test.skipIf(!isWindows)("termios flag accessors return 0 on Windows", async () => {
    await using terminal = new Bun.Terminal({});
    expect(terminal.inputFlags).toBe(0);
    expect(terminal.outputFlags).toBe(0);
    expect(terminal.localFlags).toBe(0);
    expect(terminal.controlFlags).toBe(0);
  });

  test("data callback receives output from spawned process", async () => {
    let output = "";
    let callbackTerminal: Bun.Terminal | undefined;
    const { promise, resolve } = Promise.withResolvers<void>();

    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(term, chunk: Uint8Array) {
        callbackTerminal = term;
        output += new TextDecoder().decode(chunk);
        if (output.includes("hello-from-conpty")) resolve();
      },
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('hello-from-conpty')"],
      env: bunEnv,
      terminal,
    });

    await promise;
    await proc.exited;
    terminal.close();

    expect(callbackTerminal).toBe(terminal);
    expect(output).toContain("hello-from-conpty");
  });

  test("subprocess sees a TTY on stdout", async () => {
    let output = "";
    const { promise, resolve } = Promise.withResolvers<void>();

    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_term, chunk: Uint8Array) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("isTTY=")) resolve();
      },
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdout.write('isTTY=' + process.stdout.isTTY)"],
      env: bunEnv,
      terminal,
    });

    await promise;
    await proc.exited;
    terminal.close();

    expect(output).toContain("isTTY=true");
  });

  test("Bun.spawn with inline terminal option", async () => {
    let output = "";
    const { promise, resolve } = Promise.withResolvers<void>();

    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('inline-terminal')"],
      env: bunEnv,
      terminal: {
        cols: 80,
        rows: 24,
        data(_term, chunk: Uint8Array) {
          output += new TextDecoder().decode(chunk);
          if (output.includes("inline-terminal")) resolve();
        },
      },
    });

    expect(proc.terminal).toBeDefined();
    expect(proc.stdin).toBeNull();
    expect(proc.stdout).toBeNull();
    expect(proc.stderr).toBeNull();

    await promise;
    await proc.exited;
    proc.terminal?.close();

    expect(output).toContain("inline-terminal");
  });

  test("terminal.write reaches subprocess stdin", async () => {
    let output = "";
    const { promise, resolve } = Promise.withResolvers<void>();

    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_term, chunk: Uint8Array) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("ECHO:abc")) resolve();
      },
    });

    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdin.setEncoding('utf8');
         process.stdin.on('data', d => { process.stdout.write('ECHO:' + d); process.exit(0); });`,
      ],
      env: bunEnv,
      terminal,
    });

    terminal.write("abc\r");
    await promise;
    await proc.exited;
    terminal.close();

    expect(output).toContain("ECHO:abc");
  });

  test("subprocess sees correct terminal dimensions", async () => {
    let output = "";
    const { promise, resolve } = Promise.withResolvers<void>();

    const terminal = new Bun.Terminal({
      cols: 123,
      rows: 45,
      data(_term, chunk: Uint8Array) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("cols=")) resolve();
      },
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdout.write('cols=' + process.stdout.columns + ' rows=' + process.stdout.rows)"],
      env: bunEnv,
      terminal,
    });

    await promise;
    await proc.exited;
    terminal.close();

    expect(output).toContain("cols=123");
    expect(output).toContain("rows=45");
  });

  test("exit callback fires after close", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const terminal = new Bun.Terminal({
      exit() {
        resolve();
      },
    });
    terminal.close();
    await promise;
  });

  test("can create and close many terminals", () => {
    for (let i = 0; i < 20; i++) {
      const t = new Bun.Terminal({ cols: 80, rows: 24 });
      t.close();
      expect(t.closed).toBe(true);
    }
  });

  // termios c_lflag bit layout is platform-specific. These match sys/termios.h:
  // Linux uses the "System V" layout; Darwin/BSD share the "4.3BSD" layout.
  const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
  const ECHO = 0x8; // same on both

  // Regression: a Bun pipeline producer (stdout is a pipe, stdin/stderr are
  // TTYs) that never calls setRawMode must not write its startup termios
  // snapshot back to the terminal device at exit. The bug scenario is
  // literally `bun foo.js | less`: termios is a property of the /dev/pts/*
  // device, not the fd, so restoring here clobbers raw mode set on the same
  // device by the downstream consumer. See #29592.
  //
  // openpty via bun:ffi so we can wire stdin/stderr to the slave but keep
  // stdout as a pipe — exactly the `bun foo.js | less` shape that triggers
  // the bug.
  //
  //   glibc: openpty in libutil.so.1, termios in libc.so.6.
  //   musl:  everything in libc.musl-{x86_64,aarch64}.so.1.
  //   macOS: everything in libc.dylib; tcflag_t is `unsigned long` (8 bytes
  //          on LP64), so c_lflag sits at offset 24 instead of 12. The flag
  //          bits all fit in the low u32 on both platforms, so reading a
  //          u32 at the right offset round-trips cleanly.
  test.skipIf(isWindows)("pipeline producer exit does not clobber raw mode on shared tty device", async () => {
    const LFLAG_OFFSET = process.platform === "darwin" ? 24 : 12;

    const openptyDecl = {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    } as const;
    const termiosDecls = {
      tcgetattr: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
      tcsetattr: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
    } as const;

    // Musl and macOS both keep openpty + termios in a single libc. Only
    // glibc splits openpty out into libutil.
    const lib =
      process.platform === "darwin"
        ? dlopen("libc.dylib", { openpty: openptyDecl, ...termiosDecls })
        : isMusl
          ? dlopen(process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1", {
              openpty: openptyDecl,
              ...termiosDecls,
            })
          : dlopen("libutil.so.1", { openpty: openptyDecl });
    const libc = process.platform === "darwin" || isMusl ? lib : dlopen("libc.so.6", termiosDecls);

    const masterBuf = new Int32Array(1);
    const slaveBuf = new Int32Array(1);
    expect(lib.symbols.openpty(masterBuf, slaveBuf, null, null, null)).toBe(0);
    const master = masterBuf[0];
    const slave = slaveBuf[0];

    // termios struct size:
    //   Linux  = 60 (4× u32 flags + u8 c_line + 32 cc + 3 pad + 2× u32 speed)
    //   Darwin = 72 (4× u64 flags + 20 cc + pad + 2× u64 speed)
    // 128 is generous on both platforms.
    const termiosBuf = new Uint8Array(128);

    function getLflag(): number {
      expect(libc.symbols.tcgetattr(master, termiosBuf)).toBe(0);
      return new DataView(termiosBuf.buffer).getUint32(LFLAG_OFFSET, true);
    }

    function setLflag(value: number) {
      expect(libc.symbols.tcgetattr(master, termiosBuf)).toBe(0);
      new DataView(termiosBuf.buffer).setUint32(LFLAG_OFFSET, value, true);
      expect(libc.symbols.tcsetattr(master, 0, termiosBuf)).toBe(0);
    }

    try {
      // Assert the PTY starts cooked so the test can't pass vacuously.
      expect(getLflag() & ICANON).not.toBe(0);
      expect(getLflag() & ECHO).not.toBe(0);

      const proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          // Child: stdout is a pipe (pipeline producer), stdin/stderr are
          // the PTY slave. Writes READY to stdout, then blocks on stdin
          // until the parent flips termios and tells us to exit.
          `process.stdout.write("READY\\n"); process.stdin.once("data", () => process.exit(0));`,
        ],
        env: bunEnv,
        stdin: slave,
        stdout: "pipe",
        stderr: slave,
      });

      // Wait for READY so we know the child is up and has finished
      // `bun_initialize_process` (the termios snapshot).
      const decoder = new TextDecoder();
      let buffer = "";
      const reader = proc.stdout.getReader();
      while (!buffer.includes("READY")) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      reader.releaseLock();

      // Simulate `less` flipping the shared device to raw mode.
      setLflag(getLflag() & ~(ICANON | ECHO));
      expect(getLflag() & ICANON).toBe(0);
      expect(getLflag() & ECHO).toBe(0);

      // Release the child.
      fs.writeSync(master, "\n");
      const exitCode = await proc.exited;

      // Termios bits first: these are the regression.
      expect(getLflag() & ICANON).toBe(0);
      expect(getLflag() & ECHO).toBe(0);
      expect(exitCode).toBe(0);
    } finally {
      libc.symbols.close(master);
      libc.symbols.close(slave);
    }
  });

  // Companion: an interactive-wrapper case (stdout IS a TTY, like `bun run
  // vim` where the child may have taken termios raw and crashed) keeps the
  // unconditional restore. That's the `bun_restore_stdio` branch the
  // pipeline-producer gate does not apply to: after the child exits, the
  // parent's startup snapshot is written back so the shell comes back cooked.
  test.skipIf(isWindows)("interactive wrapper (stdout tty) restores cooked termios on child exit", async () => {
    const ready = Promise.withResolvers<void>();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawReady = false;
    await using terminal = new Bun.Terminal({
      data(_, chunk: Uint8Array) {
        if (sawReady) return;
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.includes("READY")) {
          sawReady = true;
          ready.resolve();
        }
      },
    });

    expect(terminal.localFlags & ICANON).not.toBe(0);
    expect(terminal.localFlags & ECHO).not.toBe(0);

    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        // Interactive wrapper: all three stdio are the PTY. The child
        // itself does not call setRawMode — but we flip termios from the
        // parent before the child exits, to simulate a TUI that set raw
        // mode via FFI/ioctl rather than through Bun__ttySetMode.
        `process.stdout.write("READY\\n"); process.stdin.once("data", () => process.exit(0));`,
      ],
      env: bunEnv,
      terminal,
    });

    await ready.promise;

    // Child took termios raw externally (simulated by the parent here).
    terminal.localFlags = terminal.localFlags & ~(ICANON | ECHO);
    expect(terminal.localFlags & ICANON).toBe(0);
    expect(terminal.localFlags & ECHO).toBe(0);

    terminal.write("\n");
    const exitCode = await proc.exited;

    // Because stdout is a TTY (interactive wrapper, not a pipeline
    // producer), bun_restore_stdio keeps the unconditional restore and
    // writes the cooked startup snapshot back. This matches the pre-PR
    // safety net for `bun run <tui>` after the TUI crashes.
    expect(terminal.localFlags & ICANON).not.toBe(0);
    expect(terminal.localFlags & ECHO).not.toBe(0);
    expect(exitCode).toBe(0);
  });

  // Companion to the regression test above: setRawMode still has its own
  // restore path via uv_tty_reset_mode's atexit hook. A child that actually
  // modifies termios must leave the device in its pre-setRawMode state.
  //
  // Handshake with the child across its entire lifetime so the assertions
  // distinguish the three cases we care about:
  //   1. child wrote raw → assert cooked before, raw while live, cooked after
  //   2. setRawMode became a no-op → "raw while live" assertion fails
  //   3. our bookkeeping skipped the restore → "cooked after" assertion fails
  test.skipIf(isWindows)("child that called setRawMode restores termios on exit", async () => {
    const raw = Promise.withResolvers<void>();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawRaw = false;
    await using terminal = new Bun.Terminal({
      data(_, chunk: Uint8Array) {
        if (sawRaw) return;
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.includes("RAW")) {
          sawRaw = true;
          raw.resolve();
        }
      },
    });

    expect(terminal.localFlags & ICANON).not.toBe(0);
    expect(terminal.localFlags & ECHO).not.toBe(0);

    // Child enters raw mode, announces it, then blocks on stdin so the
    // parent can observe termios state while the child is still alive.
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdin.setRawMode(true); process.stdout.write("RAW\\n"); process.stdin.once("data", () => process.exit(0));`,
      ],
      env: bunEnv,
      terminal,
    });

    await raw.promise;
    expect(terminal.localFlags & ICANON).toBe(0);
    expect(terminal.localFlags & ECHO).toBe(0);

    terminal.write("\n");
    const exitCode = await proc.exited;
    expect(terminal.localFlags & ICANON).not.toBe(0);
    expect(terminal.localFlags & ECHO).not.toBe(0);
    expect(exitCode).toBe(0);
  });
});
