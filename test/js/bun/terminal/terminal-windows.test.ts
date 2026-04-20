import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Windows ConPTY-specific tests for Bun.Terminal.
// The cross-platform behaviour is exercised in terminal.test.ts; this file
// covers the parts that differ on Windows (no termios echo, ConPTY VT init
// sequence, cmd.exe instead of /bin/echo).
describe.skipIf(!isWindows)("Bun.Terminal (Windows ConPTY)", () => {
  test("constructor creates a pseudoconsole", async () => {
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

  test("termios flag accessors return 0 on Windows", async () => {
    await using terminal = new Bun.Terminal({});
    expect(terminal.inputFlags).toBe(0);
    expect(terminal.outputFlags).toBe(0);
    expect(terminal.localFlags).toBe(0);
    expect(terminal.controlFlags).toBe(0);
  });

  test("data callback receives ConPTY output from spawned process", async () => {
    let output = "";
    const { promise, resolve } = Promise.withResolvers<void>();

    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_term, chunk: Uint8Array) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("hello-from-conpty")) resolve();
      },
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('hello-from-conpty')"],
      env: bunEnv,
      terminal,
    });

    await Promise.race([promise, proc.exited.then(() => resolve())]);
    await proc.exited;
    terminal.close();

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

    await Promise.race([promise, proc.exited.then(() => resolve())]);
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

    await Promise.race([promise, proc.exited.then(() => resolve())]);
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
    await Promise.race([promise, proc.exited.then(() => resolve())]);
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

    await Promise.race([promise, proc.exited.then(() => resolve())]);
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
});
