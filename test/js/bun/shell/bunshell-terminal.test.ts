// https://github.com/oven-sh/bun/issues/33234
import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// Reports whether each of the child's std streams is a tty.
const TTY_PROBE =
  "process.stdout.write('in=' + !!process.stdin.isTTY + ' out=' + !!process.stdout.isTTY + ' err=' + !!process.stderr.isTTY)";

/**
 * A `Bun.Terminal` whose `data` callback accumulates PTY output into
 * `output()`. `finished` resolves once `done(output, terminal)` returns true.
 */
function pty(done: (output: string, terminal: Bun.Terminal) => boolean) {
  let output = "";
  const decoder = new TextDecoder();
  const finished = Promise.withResolvers<void>();
  const terminal = new Bun.Terminal({
    cols: 80,
    rows: 24,
    data(term, chunk: Uint8Array) {
      output += decoder.decode(chunk, { stream: true });
      if (done(output, term)) finished.resolve();
    },
  });
  return { terminal, finished: finished.promise, output: () => output };
}

describe.skipIf(isWindows)("ShellPromise.terminal", () => {
  test.concurrent("spawned commands see a tty on stdin, stdout, and stderr", async () => {
    const h = pty(o => o.includes("err="));
    await using terminal = h.terminal;

    await $`${bunExe()} -e ${TTY_PROBE}`.env(bunEnv).terminal(terminal);
    await h.finished;

    expect(h.output()).toContain("in=true");
    expect(h.output()).toContain("out=true");
    expect(h.output()).toContain("err=true");
  });

  test.concurrent("works with a raw interpolation, like an interactive shell executor", async () => {
    const h = pty(o => o.includes("err="));
    await using terminal = h.terminal;

    const line = `${bunExe()} -e ${$.escape(TTY_PROBE)}`;
    await $`${{ raw: line }}`.env(bunEnv).terminal(terminal);
    await h.finished;

    expect(h.output()).toContain("in=true out=true err=true");
  });

  test.concurrent("builtin output goes to the terminal, not the buffered stdout", async () => {
    const h = pty(o => o.includes("builtin-via-pty"));
    await using terminal = h.terminal;

    const result = await $`echo builtin-via-pty`.terminal(terminal);
    await h.finished;

    expect(h.output()).toContain("builtin-via-pty");
    expect(result.stdout.length).toBe(0);
    expect(result.stderr.length).toBe(0);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent(".text() is empty: output goes to the terminal even when quiet", async () => {
    const h = pty(o => o.includes("to-the-pty"));
    await using terminal = h.terminal;

    // `.text()` implies `.quiet()`; the terminal must still reach the child.
    const text = await $`${bunExe()} -e ${"process.stdout.write('to-the-pty out=' + !!process.stdout.isTTY)"}`
      .env(bunEnv)
      .terminal(terminal)
      .text();
    await h.finished;

    expect(h.output()).toContain("to-the-pty out=true");
    expect(text).toBe("");
  });

  test.concurrent("terminal.write() reaches the command's stdin", async () => {
    let wrote = false;
    const h = pty((o, term) => {
      if (!wrote && o.includes("READY")) {
        wrote = true;
        term.write("ping\n");
      }
      return o.includes("got:ping");
    });
    await using terminal = h.terminal;

    const script =
      "process.stdout.write('READY'); process.stdin.once('data', d => { process.stdout.write('got:' + d.toString().trim()); process.exit(0); });";
    await $`${bunExe()} -e ${script}`.env(bunEnv).terminal(terminal);
    await h.finished;

    expect(h.output()).toContain("got:ping");
  });

  test.concurrent("a terminal can be reused across shell invocations", async () => {
    const h = pty(o => o.includes("first-run") && o.includes("second-run"));
    await using terminal = h.terminal;

    await $`echo first-run`.terminal(terminal);
    await $`echo second-run`.terminal(terminal);
    await h.finished;

    expect(h.output()).toContain("first-run");
    expect(h.output()).toContain("second-run");
  });

  test.concurrent("in a pipeline, only the last stage's stdout is the tty", async () => {
    const h = pty(o => o.includes("a-out=") && o.includes("b-out="));
    await using terminal = h.terminal;

    // Each stage reports over stderr, which is the terminal for every stage.
    const a = "process.stderr.write('a-out=' + !!process.stdout.isTTY + ' ')";
    const b = "process.stderr.write('b-out=' + !!process.stdout.isTTY + ' ')";
    await $`${bunExe()} -e ${a} | ${bunExe()} -e ${b}`.env(bunEnv).terminal(terminal);
    await h.finished;

    expect(h.output()).toContain("a-out=false");
    expect(h.output()).toContain("b-out=true");
  });

  test.concurrent("a file redirect overrides the terminal for that fd", async () => {
    using dir = tempDir("shell-terminal-redirect", {});
    const h = pty(o => o.includes("on-stderr"));
    await using terminal = h.terminal;

    const script = "process.stdout.write('to-file'); process.stderr.write('on-stderr')";
    await $`${bunExe()} -e ${script} > out.txt`.env(bunEnv).cwd(String(dir)).terminal(terminal);
    await h.finished;

    expect(await Bun.file(join(String(dir), "out.txt")).text()).toBe("to-file");
    expect(h.output()).toContain("on-stderr");
    expect(h.output()).not.toContain("to-file");
  });

  test.concurrent(".terminal() throws once the shell is running", async () => {
    const h = pty(() => false);
    await using terminal = h.terminal;

    const promise = $`true`.terminal(terminal);
    promise.run();
    expect(() => promise.terminal(terminal)).toThrow("Shell is already running");
    await promise;
  });

  test(".terminal() rejects a non-Terminal argument", () => {
    // An options object must be rejected: the shell needs an existing handle
    // whose lifecycle the caller owns.
    expect(() => ($`true` as any).terminal({ cols: 80, rows: 24 })).toThrow("expected a Bun.Terminal");
    expect(() => ($`true` as any).terminal(null)).toThrow("expected a Bun.Terminal");
    expect(() => ($`true` as any).terminal(42)).toThrow("expected a Bun.Terminal");
  });

  test(".terminal() rejects a closed terminal", () => {
    const terminal = new Bun.Terminal({ cols: 80, rows: 24 });
    terminal.close();
    expect(() => $`true`.terminal(terminal)).toThrow("terminal is closed");
  });

  test.concurrent("closing the terminal after .terminal() but before await rejects and exits", async () => {
    const script = [
      "const t = new Bun.Terminal({ cols: 80, rows: 24 });",
      "const p = Bun.$`echo hi`.terminal(t);",
      "t.close();",
      "let caught = false;",
      "try { await p } catch { caught = true }",
      'console.log("caught=" + caught);',
    ].join("\n");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, signalCode: proc.signalCode, exitCode }).toEqual({
      stdout: "caught=true\n",
      signalCode: null,
      exitCode: 0,
    });
  });

  test.concurrent(".terminal() rejects a terminal created inline by Bun.spawn", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      terminal: { cols: 80, rows: 24 },
    });
    await using terminal = proc.terminal!;
    await proc.exited;

    expect(() => $`true`.terminal(terminal)).toThrow("cannot be reused");
  });
});

test.skipIf(!isWindows)(".terminal() throws on Windows", async () => {
  await using terminal = new Bun.Terminal({ cols: 80, rows: 24 });
  expect(() => $`true`.terminal(terminal)).toThrow("not supported on Windows");
});
