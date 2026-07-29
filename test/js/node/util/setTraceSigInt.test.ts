import { dlopen, FFIType } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows } from "harness";
import util from "node:util";

const KEYBOARD_INTERRUPT = "KEYBOARD_INTERRUPT: Script execution was interrupted by `SIGINT`";

test("setTraceSigInt validates its argument", () => {
  expect(() => util.setTraceSigInt("yes" as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string, previous = "") {
  const decoder = new TextDecoder();
  let buf = previous;
  while (!buf.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
  }
  // Surface a startup crash at the readiness wait instead of a confusing
  // downstream exit-code assertion.
  expect(buf).toContain(needle);
  return buf;
}

// Sending SIGINT to a subprocess is POSIX-only.
test.concurrent.skipIf(isWindows)("SIGINT prints a trace when enabled", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "require('node:util').setTraceSigInt(true); setInterval(() => {}, 1000); console.log('ready');",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await readUntil(proc.stdout.getReader(), "ready");
  proc.kill("SIGINT");
  await proc.exited;
  expect(await proc.stderr.text()).toContain(KEYBOARD_INTERRUPT);
  expect(proc.signalCode).toBe("SIGINT");
});

test.concurrent.skipIf(isWindows)("SIGINT prints a trace even while JS is executing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "require('node:util').setTraceSigInt(true); console.log('ready'); let x = 0; for (;;) { x += 1; }",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await readUntil(proc.stdout.getReader(), "ready");
  proc.kill("SIGINT");
  await proc.exited;
  expect(await proc.stderr.text()).toContain(KEYBOARD_INTERRUPT);
  expect(proc.signalCode).toBe("SIGINT");
});

test.concurrent.skipIf(isWindows)("disabling restores the default silent SIGINT exit", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "const util = require('node:util'); util.setTraceSigInt(true); util.setTraceSigInt(false); setInterval(() => {}, 1000); console.log('ready');",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await readUntil(proc.stdout.getReader(), "ready");
  proc.kill("SIGINT");
  await proc.exited;
  expect(await proc.stderr.text()).not.toContain(KEYBOARD_INTERRUPT);
  expect(proc.signalCode).toBe("SIGINT");
});

test.concurrent.skipIf(isWindows)("a JS SIGINT listener takes priority over the trace", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "require('node:util').setTraceSigInt(true); process.on('SIGINT', () => { console.log('user handler fired'); process.exit(42); }); setInterval(() => {}, 1000); console.log('ready');",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  const buf = await readUntil(reader, "ready");
  proc.kill("SIGINT");
  await readUntil(reader, "user handler fired", buf);
  expect(await proc.stderr.text()).not.toContain(KEYBOARD_INTERRUPT);
  expect(await proc.exited).toBe(42);
});

// Exercises the code path where onExitSignal (the termios-restoring SIGINT
// handler bun installs for TTYs) is the pre-existing disposition. Chaining
// itself is asserted by the termios test below.
test.concurrent.skipIf(isWindows)("trace fires when stdio is a TTY", async () => {
  let output = "";
  const trace = Promise.withResolvers<void>();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "require('node:util').setTraceSigInt(true); setInterval(() => {}, 1000); console.log('ready');",
    ],
    env: bunEnv,
    terminal: {
      data(_t, chunk) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("ready")) proc.kill("SIGINT");
        if (output.includes(KEYBOARD_INTERRUPT)) trace.resolve();
      },
      exit() {
        trace.reject(new Error("exited without trace; output=" + JSON.stringify(output)));
      },
    },
  });
  await trace.promise;
  await proc.exited;
  expect(proc.signalCode).toBe("SIGINT");
});

// The trace handler must chain to the previous SIGINT disposition instead of
// re-raising through SIG_DFL: with stdin on a PTY, bun's onExitSignal restores
// the startup termios before dying, and that restore must still happen with
// the trace enabled. FFI/termios plumbing mirrors
// test/js/bun/terminal/terminal-spawn.test.ts.
test.concurrent.skipIf(isWindows)("trace chains to the termios-restoring SIGINT handler", async () => {
  const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
  const ECHO = 0x8;
  const LFLAG_OFFSET = process.platform === "darwin" ? 24 : 12;

  const openptyDecl = {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  } as const;
  const termiosDecls = {
    tcgetattr: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
  } as const;
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
  const termiosBuf = new Uint8Array(128);

  function getLflag(): number {
    expect(libc.symbols.tcgetattr(master, termiosBuf)).toBe(0);
    return new DataView(termiosBuf.buffer).getUint32(LFLAG_OFFSET, true);
  }

  try {
    // The PTY starts cooked, so a restored termios is distinguishable.
    expect(getLflag() & ICANON).not.toBe(0);
    expect(getLflag() & ECHO).not.toBe(0);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "process.stdin.setRawMode(true); require('node:util').setTraceSigInt(true); setInterval(() => {}, 1000); console.log('ready');",
      ],
      env: bunEnv,
      stdin: slave,
      stdout: "pipe",
      stderr: "pipe",
    });
    await readUntil(proc.stdout.getReader(), "ready");
    // setRawMode flipped the shared device to raw.
    expect(getLflag() & ICANON).toBe(0);

    proc.kill("SIGINT");
    await proc.exited;
    expect(await proc.stderr.text()).toContain(KEYBOARD_INTERRUPT);
    expect(proc.signalCode).toBe("SIGINT");
    // Dying through the chained onExitSignal restored the cooked termios.
    expect(getLflag() & ICANON).not.toBe(0);
    expect(getLflag() & ECHO).not.toBe(0);
  } finally {
    libc.symbols.close(master);
    libc.symbols.close(slave);
  }
});

test.concurrent.skipIf(isWindows)("removing the last SIGINT listener re-arms the trace", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "const util = require('node:util'); const handler = () => {}; process.on('SIGINT', handler); util.setTraceSigInt(true); process.removeListener('SIGINT', handler); setInterval(() => {}, 1000); console.log('ready');",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await readUntil(proc.stdout.getReader(), "ready");
  proc.kill("SIGINT");
  await proc.exited;
  expect(await proc.stderr.text()).toContain(KEYBOARD_INTERRUPT);
  expect(proc.signalCode).toBe("SIGINT");
});
