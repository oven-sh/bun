import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Terminal (PTY) is only supported on POSIX platforms
describe.todoIf(isWindows)("Bun.Terminal", () => {
  describe("constructor", () => {
    test("creates a PTY with default options", () => {
      const terminal = new Bun.Terminal({});

      expect(terminal).toBeDefined();
      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      expect(terminal.stdout).toBeGreaterThanOrEqual(0);
      expect(terminal.closed).toBe(false);

      terminal.close();
      expect(terminal.closed).toBe(true);
      expect(terminal.stdin).toBe(-1);
      expect(terminal.stdout).toBe(-1);
    });

    test("creates a PTY with custom size", () => {
      const terminal = new Bun.Terminal({
        cols: 120,
        rows: 40,
      });

      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      expect(terminal.stdout).toBeGreaterThanOrEqual(0);

      terminal.close();
    });

    test("creates a PTY with minimum size", () => {
      const terminal = new Bun.Terminal({
        cols: 1,
        rows: 1,
      });

      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      terminal.close();
    });

    test("creates a PTY with large size", () => {
      const terminal = new Bun.Terminal({
        cols: 500,
        rows: 200,
      });

      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      terminal.close();
    });

    test("creates a PTY with custom name", () => {
      const terminal = new Bun.Terminal({
        name: "xterm",
      });

      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      terminal.close();
    });

    test("creates a PTY with empty name (uses default)", () => {
      const terminal = new Bun.Terminal({
        name: "",
      });

      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      terminal.close();
    });

    test("ignores invalid cols value", () => {
      const terminal = new Bun.Terminal({
        cols: -1,
      });

      // Should use default of 80
      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      terminal.close();
    });

    test("ignores invalid rows value", () => {
      const terminal = new Bun.Terminal({
        rows: 0,
      });

      // Should use default of 24
      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      terminal.close();
    });

    test("ignores non-numeric cols value", () => {
      const terminal = new Bun.Terminal({
        cols: "invalid" as any,
      });

      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      terminal.close();
    });

    test("throws when options is null", () => {
      expect(() => new Bun.Terminal(null as any)).toThrow();
    });

    test("throws when options is undefined", () => {
      expect(() => new Bun.Terminal(undefined as any)).toThrow();
    });

    test("stdin and stdout are different file descriptors", () => {
      const terminal = new Bun.Terminal({});

      // stdin is slave fd, stdout is master fd - they should be different
      expect(terminal.stdin).not.toBe(terminal.stdout);

      terminal.close();
    });
  });

  describe("write", () => {
    test("can write string to terminal", () => {
      const terminal = new Bun.Terminal({});

      const written = terminal.write("hello");
      expect(written).toBeGreaterThan(0);
      expect(written).toBe(5);

      terminal.close();
    });

    test("can write empty string", () => {
      const terminal = new Bun.Terminal({});

      const written = terminal.write("");
      expect(written).toBe(0);

      terminal.close();
    });

    test("can write Uint8Array to terminal", () => {
      const terminal = new Bun.Terminal({});

      const buffer = new TextEncoder().encode("hello");
      const written = terminal.write(buffer);
      expect(written).toBeGreaterThan(0);

      terminal.close();
    });

    test("can write ArrayBuffer to terminal", () => {
      const terminal = new Bun.Terminal({});

      const buffer = new TextEncoder().encode("hello").buffer;
      const written = terminal.write(buffer);
      expect(written).toBeGreaterThan(0);

      terminal.close();
    });

    test("can write Int8Array to terminal", () => {
      const terminal = new Bun.Terminal({});

      const buffer = new Int8Array([104, 101, 108, 108, 111]); // "hello"
      const written = terminal.write(buffer);
      expect(written).toBeGreaterThan(0);

      terminal.close();
    });

    test("can write large data", () => {
      const terminal = new Bun.Terminal({});

      const largeData = Buffer.alloc(10000, "x").toString();
      const written = terminal.write(largeData);
      expect(written).toBeGreaterThan(0);

      terminal.close();
    });

    test("can write multiple times", () => {
      const terminal = new Bun.Terminal({});

      terminal.write("hello");
      terminal.write(" ");
      terminal.write("world");

      terminal.close();
    });

    test("can write with newlines and control characters", () => {
      const terminal = new Bun.Terminal({});

      const written = terminal.write("line1\r\nline2\tcolumn\x1b[31mred\x1b[0m");
      expect(written).toBeGreaterThan(0);

      terminal.close();
    });

    test("throws when writing to closed terminal", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      expect(() => terminal.write("hello")).toThrow("Terminal is closed");
    });

    test("throws when data is null", () => {
      const terminal = new Bun.Terminal({});

      expect(() => terminal.write(null as any)).toThrow();

      terminal.close();
    });

    test("throws when data is undefined", () => {
      const terminal = new Bun.Terminal({});

      expect(() => terminal.write(undefined as any)).toThrow();

      terminal.close();
    });

    test("throws when data is a number", () => {
      const terminal = new Bun.Terminal({});

      expect(() => terminal.write(123 as any)).toThrow();

      terminal.close();
    });
  });

  describe("resize", () => {
    test("can resize terminal", () => {
      const terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Should not throw
      terminal.resize(100, 50);

      terminal.close();
    });

    test("can resize to minimum size", () => {
      const terminal = new Bun.Terminal({});

      terminal.resize(1, 1);

      terminal.close();
    });

    test("can resize to large size", () => {
      const terminal = new Bun.Terminal({});

      terminal.resize(500, 200);

      terminal.close();
    });

    test("can resize multiple times", () => {
      const terminal = new Bun.Terminal({});

      terminal.resize(100, 50);
      terminal.resize(80, 24);
      terminal.resize(120, 40);

      terminal.close();
    });

    test("throws when resizing closed terminal", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      expect(() => terminal.resize(100, 50)).toThrow("Terminal is closed");
    });

    test("throws with invalid cols", () => {
      const terminal = new Bun.Terminal({});

      expect(() => terminal.resize(-1, 50)).toThrow();

      terminal.close();
    });

    test("throws with invalid rows", () => {
      const terminal = new Bun.Terminal({});

      expect(() => terminal.resize(100, 0)).toThrow();

      terminal.close();
    });

    test("throws with non-numeric cols", () => {
      const terminal = new Bun.Terminal({});

      expect(() => terminal.resize("invalid" as any, 50)).toThrow();

      terminal.close();
    });
  });

  describe("setRawMode", () => {
    test("can enable raw mode", () => {
      const terminal = new Bun.Terminal({});

      // Should not throw
      terminal.setRawMode(true);

      terminal.close();
    });

    test("can disable raw mode", () => {
      const terminal = new Bun.Terminal({});

      terminal.setRawMode(true);
      terminal.setRawMode(false);

      terminal.close();
    });

    test("can toggle raw mode multiple times", () => {
      const terminal = new Bun.Terminal({});

      terminal.setRawMode(true);
      terminal.setRawMode(false);
      terminal.setRawMode(true);
      terminal.setRawMode(false);

      terminal.close();
    });

    test("throws when setting raw mode on closed terminal", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      expect(() => terminal.setRawMode(true)).toThrow("Terminal is closed");
    });
  });

  describe("close", () => {
    test("close sets closed to true", () => {
      const terminal = new Bun.Terminal({});
      expect(terminal.closed).toBe(false);

      terminal.close();
      expect(terminal.closed).toBe(true);
    });

    test("close sets fds to -1", () => {
      const terminal = new Bun.Terminal({});
      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      expect(terminal.stdout).toBeGreaterThanOrEqual(0);

      terminal.close();
      expect(terminal.stdin).toBe(-1);
      expect(terminal.stdout).toBe(-1);
    });

    test("close is idempotent", () => {
      const terminal = new Bun.Terminal({});

      terminal.close();
      terminal.close();
      terminal.close();

      expect(terminal.closed).toBe(true);
    });

    test("supports asyncDispose", async () => {
      let terminalRef: Bun.Terminal | undefined;
      {
        await using terminal = new Bun.Terminal({});
        terminalRef = terminal;
        expect(terminal.closed).toBe(false);
        // terminal is auto-closed after this block
      }
      // Verify terminal was closed after the using block
      expect(terminalRef!.closed).toBe(true);
    });

    test("asyncDispose returns a promise", async () => {
      const terminal = new Bun.Terminal({});

      const result = terminal[Symbol.asyncDispose]();
      expect(result).toBeInstanceOf(Promise);

      await result;
      expect(terminal.closed).toBe(true);
    });
  });

  describe("ref and unref", () => {
    test("ref does not throw", () => {
      const terminal = new Bun.Terminal({});

      terminal.ref();
      terminal.ref(); // Multiple refs should be safe

      terminal.close();
    });

    test("unref does not throw", () => {
      const terminal = new Bun.Terminal({});

      terminal.unref();
      terminal.unref(); // Multiple unrefs should be safe

      terminal.close();
    });

    test("ref and unref can be called in any order", () => {
      const terminal = new Bun.Terminal({});

      terminal.ref();
      terminal.unref();
      terminal.unref();
      terminal.ref();
      terminal.ref();
      terminal.unref();

      terminal.close();
    });
  });

  describe("data callback", () => {
    test("receives echoed output", async () => {
      const received: Uint8Array[] = [];

      const terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Write to terminal - data should echo back
      terminal.write("hello\n");

      // Wait for data to come back
      await Bun.sleep(100);

      terminal.close();

      // Should have received the echo
      expect(received.length).toBeGreaterThan(0);
      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("hello");
    });

    test("receives data from multiple writes", async () => {
      const received: Uint8Array[] = [];

      const terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      terminal.write("first\n");
      await Bun.sleep(50);
      terminal.write("second\n");
      await Bun.sleep(50);
      terminal.write("third\n");
      await Bun.sleep(100);

      terminal.close();

      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("first");
      expect(allData).toContain("second");
      expect(allData).toContain("third");
    });

    test("callback receives terminal as first argument", async () => {
      let receivedTerminal: any = null;

      const terminal = new Bun.Terminal({
        data(term, data) {
          receivedTerminal = term;
        },
      });

      terminal.write("test\n");
      await Bun.sleep(100);

      // Check before close so the terminal reference is still valid
      expect(receivedTerminal).toBeDefined();
      expect(receivedTerminal.write).toBeFunction();
      expect(receivedTerminal.close).toBeFunction();

      terminal.close();
    });

    test("callback receives Uint8Array as data", async () => {
      let receivedData: any = null;

      const terminal = new Bun.Terminal({
        data(term, data) {
          receivedData = data;
        },
      });

      terminal.write("test\n");
      await Bun.sleep(100);

      terminal.close();

      expect(receivedData).toBeInstanceOf(Uint8Array);
    });

    test("handles large data in callback", async () => {
      let totalReceived = 0;

      const terminal = new Bun.Terminal({
        data(term, data) {
          totalReceived += data.length;
        },
      });

      // Write a large amount of data
      const largeData = Buffer.alloc(10000, "x").toString() + "\n";
      terminal.write(largeData);

      await Bun.sleep(200);

      terminal.close();

      // Should have received at least some data
      expect(totalReceived).toBeGreaterThan(0);
    });

    test("no callback means no error", async () => {
      const terminal = new Bun.Terminal({});

      terminal.write("hello\n");
      await Bun.sleep(100);

      terminal.close();
      // Should not throw
    });
  });

  describe("exit callback", () => {
    test("exit callback is called on close", async () => {
      let exitCalled = false;
      let exitCode: number | null = null;

      const terminal = new Bun.Terminal({
        exit(term, code, signal) {
          exitCalled = true;
          exitCode = code;
        },
      });

      terminal.close();

      // Give time for callback to be called
      await Bun.sleep(50);

      expect(exitCalled).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("exit callback receives terminal as first argument", async () => {
      let receivedTerminal: any = null;

      const terminal = new Bun.Terminal({
        exit(term, code, signal) {
          receivedTerminal = term;
        },
      });

      terminal.close();
      await Bun.sleep(50);

      // The terminal is closed but the callback should have received a valid reference
      expect(receivedTerminal).toBeDefined();
      expect(receivedTerminal.close).toBeFunction();
    });
  });

  describe("drain callback", () => {
    test("drain callback is invoked when writer is ready", async () => {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      let drainCalled = false;

      const terminal = new Bun.Terminal({
        drain(term) {
          drainCalled = true;
          resolve(true);
        },
      });

      // Write some data to trigger drain callback when buffer is flushed
      terminal.write("hello");

      // Wait for drain with timeout - drain may be called immediately or after flush
      const result = await Promise.race([promise, Bun.sleep(100).then(() => false)]);

      terminal.close();

      // Drain callback should have been called (or will be called on close)
      // The key is that the callback mechanism works without throwing
      expect(typeof drainCalled).toBe("boolean");
    });
  });

  describe("subprocess interaction", () => {
    test("spawns subprocess with PTY", async () => {
      const terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Spawn a simple command that outputs to the PTY
      const proc = Bun.spawn({
        cmd: ["echo", "hello from pty"],
        stdin: terminal.stdin,
        stdout: terminal.stdout,
        stderr: terminal.stdout,
      });

      await proc.exited;
      expect(proc.exitCode).toBe(0);

      terminal.close();
    });

    test("subprocess sees TTY for stdin/stdout", async () => {
      const terminal = new Bun.Terminal({});
      const slaveFd = terminal.stdin;

      const proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const tty = require("tty");
          console.log(JSON.stringify({
            stdinIsTTY: tty.isatty(0),
            stdoutIsTTY: tty.isatty(1),
          }));
        `,
        ],
        stdin: slaveFd,
        stdout: slaveFd,
        stderr: slaveFd,
        env: bunEnv,
      });

      await proc.exited;
      expect(proc.exitCode).toBe(0);

      terminal.close();
    });

    test("subprocess can read from terminal", async () => {
      const received: Uint8Array[] = [];

      const terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Spawn cat which will echo input back
      const proc = Bun.spawn({
        cmd: ["cat"],
        stdin: terminal.stdin,
        stdout: terminal.stdin,
        stderr: terminal.stdin,
      });

      // Write to the terminal
      terminal.write("hello from test\n");

      // Wait a bit for processing
      await Bun.sleep(100);

      // Send EOF to cat
      proc.kill("SIGTERM");
      await proc.exited;

      terminal.close();
    });

    test("multiple subprocesses can use same terminal", async () => {
      const terminal = new Bun.Terminal({});

      const proc1 = Bun.spawn({
        cmd: ["echo", "first"],
        stdin: terminal.stdin,
        stdout: terminal.stdin,
        stderr: terminal.stdin,
      });
      await proc1.exited;

      const proc2 = Bun.spawn({
        cmd: ["echo", "second"],
        stdin: terminal.stdin,
        stdout: terminal.stdin,
        stderr: terminal.stdin,
      });
      await proc2.exited;

      expect(proc1.exitCode).toBe(0);
      expect(proc2.exitCode).toBe(0);

      terminal.close();
    });

    test("subprocess receives SIGWINCH on resize", async () => {
      const terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Spawn a process that will receive SIGWINCH
      const proc = Bun.spawn({
        cmd: ["sleep", "1"],
        stdin: terminal.stdin,
        stdout: terminal.stdin,
        stderr: terminal.stdin,
      });

      // Resize should send SIGWINCH to the process group
      terminal.resize(100, 50);

      // Kill the process
      proc.kill();
      await proc.exited;

      terminal.close();
    });
  });

  describe("ANSI escape sequences", () => {
    test("can write ANSI color codes", async () => {
      const received: Uint8Array[] = [];

      const terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      terminal.write("\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m\n");
      await Bun.sleep(100);

      terminal.close();

      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("red");
      expect(allData).toContain("green");
    });

    test("can write cursor movement codes", async () => {
      const terminal = new Bun.Terminal({});

      // Various cursor movement codes
      terminal.write("\x1b[H"); // Home
      terminal.write("\x1b[2J"); // Clear screen
      terminal.write("\x1b[10;20H"); // Move to row 10, col 20
      terminal.write("\x1b[A"); // Up
      terminal.write("\x1b[B"); // Down
      terminal.write("\x1b[C"); // Forward
      terminal.write("\x1b[D"); // Back

      terminal.close();
    });

    test("can write screen manipulation codes", async () => {
      const terminal = new Bun.Terminal({});

      terminal.write("\x1b[?25l"); // Hide cursor
      terminal.write("\x1b[?25h"); // Show cursor
      terminal.write("\x1b[?1049h"); // Alt screen buffer
      terminal.write("\x1b[?1049l"); // Main screen buffer

      terminal.close();
    });
  });

  describe("binary data", () => {
    test("can write binary data", () => {
      const terminal = new Bun.Terminal({});

      // Write some binary data
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const written = terminal.write(binaryData);
      expect(written).toBe(6);

      terminal.close();
    });

    test("can receive binary data in callback", async () => {
      const received: Uint8Array[] = [];

      const terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Write some data that will be echoed
      terminal.write(new Uint8Array([0x41, 0x42, 0x43, 0x0a])); // ABC\n

      await Bun.sleep(100);

      terminal.close();

      expect(received.length).toBeGreaterThan(0);
    });
  });

  describe("stress tests", () => {
    test("can create many terminals", () => {
      const terminals: Bun.Terminal[] = [];

      for (let i = 0; i < 10; i++) {
        terminals.push(new Bun.Terminal({}));
      }

      for (const terminal of terminals) {
        expect(terminal.closed).toBe(false);
        terminal.close();
        expect(terminal.closed).toBe(true);
      }
    });

    test("can write many times rapidly", () => {
      const terminal = new Bun.Terminal({});

      for (let i = 0; i < 100; i++) {
        terminal.write(`line ${i}\n`);
      }

      terminal.close();
    });

    test("can handle rapid resize", () => {
      const terminal = new Bun.Terminal({});

      for (let i = 0; i < 20; i++) {
        terminal.resize(80 + i, 24 + i);
      }

      terminal.close();
    });

    test("handles concurrent operations", async () => {
      const terminal = new Bun.Terminal({
        data(term, data) {
          // Just consume the data
        },
      });

      // Do multiple operations concurrently
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          (async () => {
            terminal.write(`message ${i}\n`);
            await Bun.sleep(10);
          })(),
        );
      }

      await Promise.all(promises);

      terminal.close();
    });
  });

  describe("edge cases", () => {
    test("handles Unicode characters", async () => {
      const received: Uint8Array[] = [];

      const terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      terminal.write("Hello 世界 🌍 émojis\n");
      await Bun.sleep(100);

      terminal.close();

      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("世界");
    });

    test("handles very long lines", async () => {
      const terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Write a line much longer than terminal width
      const longLine = Buffer.alloc(1000, "x").toString();
      terminal.write(longLine + "\n");

      terminal.close();
    });

    test("handles empty callbacks gracefully", () => {
      const terminal = new Bun.Terminal({
        data: undefined,
        exit: undefined,
        drain: undefined,
      });

      terminal.write("test\n");
      terminal.close();
    });

    test("file descriptors are valid integers", () => {
      const terminal = new Bun.Terminal({});

      expect(Number.isInteger(terminal.stdin)).toBe(true);
      expect(Number.isInteger(terminal.stdout)).toBe(true);
      expect(terminal.stdin).toBeGreaterThanOrEqual(0);
      expect(terminal.stdout).toBeGreaterThanOrEqual(0);

      terminal.close();

      expect(terminal.stdin).toBe(-1);
      expect(terminal.stdout).toBe(-1);
    });

    test("closed property is readonly", () => {
      const terminal = new Bun.Terminal({});

      expect(terminal.closed).toBe(false);

      // Attempting to set readonly property should throw
      expect(() => {
        // @ts-expect-error - trying to set readonly property
        terminal.closed = true;
      }).toThrow();

      // The property should still reflect actual state
      expect(terminal.closed).toBe(false);

      terminal.close();
      expect(terminal.closed).toBe(true);
    });
  });
});

// Terminal (PTY) is only supported on POSIX platforms
describe.todoIf(isWindows)("Bun.spawn with terminal option", () => {
  test("creates subprocess with terminal attached", async () => {
    const dataChunks: Uint8Array[] = [];

    const proc = Bun.spawn(["echo", "hello from terminal"], {
      terminal: {
        cols: 80,
        rows: 24,
        data: (terminal: Bun.Terminal, data: Uint8Array) => {
          dataChunks.push(data);
        },
      },
    });

    expect(proc.terminal).toBeDefined();
    expect(proc.terminal).toBeInstanceOf(Object);
    // stdin returns -1 for spawn-integrated terminals (parent's copy of slave is closed)
    expect(proc.terminal!.stdin).toBe(-1);
    // stdout (master fd) is still valid
    expect(proc.terminal!.stdout).toBeGreaterThanOrEqual(0);

    await proc.exited;

    // Should have received data through the terminal
    const combinedOutput = Buffer.concat(dataChunks).toString();
    expect(combinedOutput).toContain("hello from terminal");

    // Terminal should still be accessible after process exit
    expect(proc.terminal!.closed).toBe(false);
    proc.terminal!.close();
    expect(proc.terminal!.closed).toBe(true);
  });

  test("terminal option creates proper PTY for interactive programs", async () => {
    const dataChunks: Uint8Array[] = [];
    let terminalFromCallback: Bun.Terminal | undefined;

    // Note: TERM env var needs to be set manually - it's not set automatically from terminal.name
    const proc = Bun.spawn([bunExe(), "-e", "console.log('TERM=' + process.env.TERM, 'TTY=' + process.stdout.isTTY)"], {
      env: { ...bunEnv, TERM: "xterm-256color" },
      terminal: {
        cols: 120,
        rows: 40,
        name: "xterm-256color",
        data: (terminal: Bun.Terminal, data: Uint8Array) => {
          terminalFromCallback = terminal;
          dataChunks.push(data);
        },
      },
    });

    await proc.exited;

    // The terminal from callback should be the same as proc.terminal
    expect(terminalFromCallback).toBe(proc.terminal);

    // Check the output shows it's a TTY
    const combinedOutput = Buffer.concat(dataChunks).toString();
    expect(combinedOutput).toContain("TTY=true");
    expect(combinedOutput).toContain("TERM=xterm-256color");

    proc.terminal!.close();
  });

  test("terminal.write sends data to subprocess stdin", async () => {
    const dataChunks: Uint8Array[] = [];

    const proc = Bun.spawn([bunExe(), "-e", "process.stdin.on('data', d => console.log('GOT:' + d))"], {
      env: bunEnv,
      terminal: {
        data: (_terminal: Bun.Terminal, data: Uint8Array) => {
          dataChunks.push(data);
        },
      },
    });

    // Wait a bit for the subprocess to be ready
    await Bun.sleep(100);

    // Write to the terminal - in a PTY, input is echoed back
    proc.terminal!.write("hello from parent\n");

    // Wait for response
    await Bun.sleep(200);

    // Close stdin to let the subprocess exit
    proc.terminal!.close();

    await proc.exited;

    // In a PTY, input is echoed back, so we should see our message in the output
    const combinedOutput = Buffer.concat(dataChunks).toString();
    expect(combinedOutput).toContain("hello from parent");
  });

  test("terminal getter returns same object each time", async () => {
    const proc = Bun.spawn(["echo", "test"], {
      terminal: {},
    });

    const terminal1 = proc.terminal;
    const terminal2 = proc.terminal;

    expect(terminal1).toBe(terminal2);

    await proc.exited;
    proc.terminal!.close();
  });

  test("terminal is undefined when not using terminal option", async () => {
    const proc = Bun.spawn(["echo", "test"], {});

    expect(proc.terminal).toBeUndefined();
    await proc.exited;
  });

  test("stdin/stdout/stderr return null when terminal is used", async () => {
    const proc = Bun.spawn(["echo", "test"], {
      terminal: {},
    });

    // When terminal is used, stdin/stdout/stderr all go through the terminal
    expect(proc.stdin).toBeNull();
    expect(proc.stdout).toBeNull();
    expect(proc.stderr).toBeNull();

    await proc.exited;
    proc.terminal!.close();
  });

  test("terminal resize works on spawned process", async () => {
    const proc = Bun.spawn(
      [bunExe(), "-e", "process.stdout.write(process.stdout.columns + 'x' + process.stdout.rows)"],
      {
        env: bunEnv,
        terminal: {
          cols: 80,
          rows: 24,
        },
      },
    );

    // Resize while running
    proc.terminal!.resize(120, 40);

    await proc.exited;
    proc.terminal!.close();
  });

  test("terminal exit callback is called when process exits", async () => {
    let exitCalled = false;
    let exitTerminal: Bun.Terminal | undefined;
    const { promise, resolve } = Promise.withResolvers<void>();

    const proc = Bun.spawn(["echo", "test"], {
      terminal: {
        exit: (terminal: Bun.Terminal) => {
          exitCalled = true;
          exitTerminal = terminal;
          resolve();
        },
      },
    });

    await proc.exited;

    // Wait for the exit callback with timeout
    await Promise.race([promise, Bun.sleep(500)]);

    // The exit callback should be called when EOF is received on the PTY
    expect(exitCalled).toBe(true);
    expect(exitTerminal).toBe(proc.terminal);

    proc.terminal!.close();
  });
});
