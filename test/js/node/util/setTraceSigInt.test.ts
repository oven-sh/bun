import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
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

// When stdio is a TTY, bun installs a SIGINT handler that restores termios
// before dying (onExitSignal). The trace handler must chain to it, not
// replace it with SIG_DFL.
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
