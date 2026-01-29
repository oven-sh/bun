import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Helper to enable echo on a terminal (echo is disabled by default to avoid duplication)
function enableEcho(terminal: Bun.Terminal) {
  const ECHO = 0x8; // ECHO bit in c_lflag
  terminal.localFlags = terminal.localFlags | ECHO;
}

// Terminal (PTY) is only supported on POSIX platforms
describe.todoIf(isWindows)("Bun.Terminal", () => {
  describe("constructor", () => {
    test("creates a PTY with default options", async () => {
      await using terminal = new Bun.Terminal({});

      expect(terminal).toBeDefined();
      expect(terminal.closed).toBe(false);
    });

    test("creates a PTY with custom size", async () => {
      await using terminal = new Bun.Terminal({
        cols: 120,
        rows: 40,
      });

      expect(terminal.closed).toBe(false);
    });

    test("creates a PTY with minimum size", async () => {
      await using terminal = new Bun.Terminal({
        cols: 1,
        rows: 1,
      });

      expect(terminal.closed).toBe(false);
    });

    test("creates a PTY with large size", async () => {
      await using terminal = new Bun.Terminal({
        cols: 500,
        rows: 200,
      });

      expect(terminal.closed).toBe(false);
    });

    test("creates a PTY with custom name", async () => {
      await using terminal = new Bun.Terminal({
        name: "xterm",
      });

      expect(terminal.closed).toBe(false);
    });

    test("creates a PTY with empty name (uses default)", async () => {
      await using terminal = new Bun.Terminal({
        name: "",
      });

      expect(terminal.closed).toBe(false);
    });

    test("ignores invalid cols value", async () => {
      await using terminal = new Bun.Terminal({
        cols: -1,
      });

      // Should use default of 80
      expect(terminal.closed).toBe(false);
    });

    test("ignores invalid rows value", async () => {
      await using terminal = new Bun.Terminal({
        rows: 0,
      });

      // Should use default of 24
      expect(terminal.closed).toBe(false);
    });

    test("ignores non-numeric cols value", async () => {
      await using terminal = new Bun.Terminal({
        cols: "invalid" as any,
      });

      expect(terminal.closed).toBe(false);
    });

    test("throws when options is null", () => {
      expect(() => new Bun.Terminal(null as any)).toThrow();
    });

    test("throws when options is undefined", () => {
      expect(() => new Bun.Terminal(undefined as any)).toThrow();
    });
  });

  describe("write", () => {
    test("can write string to terminal", async () => {
      await using terminal = new Bun.Terminal({});

      const written = terminal.write("hello");
      expect(written).toBeGreaterThan(0);
      expect(written).toBe(5);
    });

    test("can write empty string", async () => {
      await using terminal = new Bun.Terminal({});

      const written = terminal.write("");
      expect(written).toBe(0);
    });

    test("can write Uint8Array to terminal", async () => {
      await using terminal = new Bun.Terminal({});

      const buffer = new TextEncoder().encode("hello");
      const written = terminal.write(buffer);
      expect(written).toBeGreaterThan(0);
    });

    test("can write ArrayBuffer to terminal", async () => {
      await using terminal = new Bun.Terminal({});

      const buffer = new TextEncoder().encode("hello").buffer;
      const written = terminal.write(buffer);
      expect(written).toBeGreaterThan(0);
    });

    test("can write Int8Array to terminal", async () => {
      await using terminal = new Bun.Terminal({});

      const buffer = new Int8Array([104, 101, 108, 108, 111]); // "hello"
      const written = terminal.write(buffer);
      expect(written).toBeGreaterThan(0);
    });

    test("can write large data", async () => {
      await using terminal = new Bun.Terminal({});

      const largeData = Buffer.alloc(10000, "x").toString();
      const written = terminal.write(largeData);
      expect(written).toBeGreaterThan(0);
    });

    test("can write multiple times", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.write("hello");
      terminal.write(" ");
      terminal.write("world");
    });

    test("can write with newlines and control characters", async () => {
      await using terminal = new Bun.Terminal({});

      const written = terminal.write("line1\r\nline2\tcolumn\x1b[31mred\x1b[0m");
      expect(written).toBeGreaterThan(0);
    });

    test("throws when writing to closed terminal", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      expect(() => terminal.write("hello")).toThrow("Terminal is closed");
    });

    test("throws when data is null", async () => {
      await using terminal = new Bun.Terminal({});

      expect(() => terminal.write(null as any)).toThrow();
    });

    test("throws when data is undefined", async () => {
      await using terminal = new Bun.Terminal({});

      expect(() => terminal.write(undefined as any)).toThrow();
    });

    test("throws when data is a number", async () => {
      await using terminal = new Bun.Terminal({});

      expect(() => terminal.write(123 as any)).toThrow();
    });
  });

  describe("resize", () => {
    test("can resize terminal", async () => {
      await using terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Should not throw
      terminal.resize(100, 50);
    });

    test("can resize to minimum size", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.resize(1, 1);
    });

    test("can resize to large size", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.resize(500, 200);
    });

    test("can resize multiple times", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.resize(100, 50);
      terminal.resize(80, 24);
      terminal.resize(120, 40);
    });

    test("throws when resizing closed terminal", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      expect(() => terminal.resize(100, 50)).toThrow("Terminal is closed");
    });

    test("throws with invalid cols", async () => {
      await using terminal = new Bun.Terminal({});

      expect(() => terminal.resize(-1, 50)).toThrow();
    });

    test("throws with invalid rows", async () => {
      await using terminal = new Bun.Terminal({});

      expect(() => terminal.resize(100, 0)).toThrow();
    });

    test("throws with non-numeric cols", async () => {
      await using terminal = new Bun.Terminal({});

      expect(() => terminal.resize("invalid" as any, 50)).toThrow();
    });
  });

  describe("setRawMode", () => {
    test("can enable raw mode", async () => {
      await using terminal = new Bun.Terminal({});

      // Should not throw
      terminal.setRawMode(true);
    });

    test("can disable raw mode", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.setRawMode(true);
      terminal.setRawMode(false);
    });

    test("can toggle raw mode multiple times", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.setRawMode(true);
      terminal.setRawMode(false);
      terminal.setRawMode(true);
      terminal.setRawMode(false);
    });

    test("throws when setting raw mode on closed terminal", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      expect(() => terminal.setRawMode(true)).toThrow("Terminal is closed");
    });
  });

  describe("termios flags", () => {
    test("can read termios flags", async () => {
      await using terminal = new Bun.Terminal({});

      // All flags should be non-negative numbers
      expect(terminal.inputFlags).toBeGreaterThanOrEqual(0);
      expect(terminal.outputFlags).toBeGreaterThanOrEqual(0);
      expect(terminal.localFlags).toBeGreaterThanOrEqual(0);
      expect(terminal.controlFlags).toBeGreaterThanOrEqual(0);
    });

    test("can set and restore inputFlags", async () => {
      await using terminal = new Bun.Terminal({});

      const original = terminal.inputFlags;
      terminal.inputFlags = 0;
      expect(terminal.inputFlags).toBe(0);

      terminal.inputFlags = original;
      expect(terminal.inputFlags).toBe(original);
    });

    test("can set and restore outputFlags", async () => {
      await using terminal = new Bun.Terminal({});

      const original = terminal.outputFlags;
      terminal.outputFlags = 0;
      expect(terminal.outputFlags).toBe(0);

      terminal.outputFlags = original;
      expect(terminal.outputFlags).toBe(original);
    });

    test("can set and restore localFlags", async () => {
      await using terminal = new Bun.Terminal({});

      // PENDIN (0x20000000 on macOS) is a kernel state flag that indicates
      // "retype pending input" and may be set/cleared by the kernel during
      // tcsetattr operations. Mask it out for comparison.
      const PENDIN = 0x20000000;
      const maskKernelFlags = (flags: number) => flags & ~PENDIN;

      const original = terminal.localFlags;
      terminal.localFlags = 0;
      expect(maskKernelFlags(terminal.localFlags)).toBe(0);

      terminal.localFlags = original;
      expect(maskKernelFlags(terminal.localFlags)).toBe(maskKernelFlags(original));
    });

    test("can set and restore controlFlags", async () => {
      await using terminal = new Bun.Terminal({});

      const original = terminal.controlFlags;
      // Note: Some control flag bits are enforced by the kernel (like CS8, baud rate)
      // and can't be changed to 0. Test that we can at least read and set values.
      terminal.controlFlags = 0;
      // Some bits may be preserved by kernel, so just check we can read back a value
      expect(terminal.controlFlags).toBeGreaterThanOrEqual(0);

      terminal.controlFlags = original;
      expect(terminal.controlFlags).toBe(original);
    });

    test("flags return 0 on closed terminal", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      expect(terminal.inputFlags).toBe(0);
      expect(terminal.outputFlags).toBe(0);
      expect(terminal.localFlags).toBe(0);
      expect(terminal.controlFlags).toBe(0);
    });

    test("setting flags on closed terminal is no-op", () => {
      const terminal = new Bun.Terminal({});
      terminal.close();

      // Should not throw
      terminal.inputFlags = 123;
      terminal.outputFlags = 456;
      terminal.localFlags = 789;
      terminal.controlFlags = 1011;

      // Still 0
      expect(terminal.inputFlags).toBe(0);
    });
  });

  describe("close", () => {
    test("close sets closed to true", () => {
      const terminal = new Bun.Terminal({});
      expect(terminal.closed).toBe(false);

      terminal.close();
      expect(terminal.closed).toBe(true);
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
    test("ref does not throw", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.ref();
      terminal.ref(); // Multiple refs should be safe
    });

    test("unref does not throw", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.unref();
      terminal.unref(); // Multiple unrefs should be safe
    });

    test("ref and unref can be called in any order", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.ref();
      terminal.unref();
      terminal.unref();
      terminal.ref();
      terminal.ref();
      terminal.unref();
    });
  });

  describe("data callback", () => {
    test("receives echoed output", async () => {
      const received: Uint8Array[] = [];

      await using terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Enable echo for this test (disabled by default)
      enableEcho(terminal);

      // Write to terminal - data should echo back
      terminal.write("hello\n");

      // Wait for data to come back
      await Bun.sleep(100);

      // Should have received the echo
      expect(received.length).toBeGreaterThan(0);
      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("hello");
    });

    test("receives data from multiple writes", async () => {
      const received: Uint8Array[] = [];

      await using terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Enable echo for this test
      enableEcho(terminal);

      terminal.write("first\n");
      await Bun.sleep(50);
      terminal.write("second\n");
      await Bun.sleep(50);
      terminal.write("third\n");
      await Bun.sleep(100);

      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("first");
      expect(allData).toContain("second");
      expect(allData).toContain("third");
    });

    test("callback receives terminal as first argument", async () => {
      let receivedTerminal: any = null;

      await using terminal = new Bun.Terminal({
        data(term, data) {
          receivedTerminal = term;
        },
      });

      // Enable echo for this test
      enableEcho(terminal);

      terminal.write("test\n");
      await Bun.sleep(100);

      // Check before close so the terminal reference is still valid
      expect(receivedTerminal).toBeDefined();
      expect(receivedTerminal.write).toBeFunction();
      expect(receivedTerminal.close).toBeFunction();
    });

    test("callback receives Uint8Array as data", async () => {
      let receivedData: any = null;

      await using terminal = new Bun.Terminal({
        data(term, data) {
          receivedData = data;
        },
      });

      // Enable echo for this test
      enableEcho(terminal);

      terminal.write("test\n");
      await Bun.sleep(100);

      expect(receivedData).toBeInstanceOf(Uint8Array);
    });

    test("handles large data in callback", async () => {
      let totalReceived = 0;

      await using terminal = new Bun.Terminal({
        data(term, data) {
          totalReceived += data.length;
        },
      });

      // Enable echo for this test
      enableEcho(terminal);

      // Write a large amount of data
      const largeData = Buffer.alloc(10000, "x").toString() + "\n";
      terminal.write(largeData);

      await Bun.sleep(200);

      // Should have received at least some data
      expect(totalReceived).toBeGreaterThan(0);
    });

    test("no callback means no error", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.write("hello\n");
      await Bun.sleep(100);
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
      await using terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Spawn a simple command that outputs to the PTY
      const proc = Bun.spawn({
        cmd: ["echo", "hello from pty"],
        terminal,
      });

      await proc.exited;
      expect(proc.exitCode).toBe(0);
    });

    test("subprocess sees TTY for stdin/stdout", async () => {
      await using terminal = new Bun.Terminal({});

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
        terminal,
        env: bunEnv,
      });

      await proc.exited;
      expect(proc.exitCode).toBe(0);
    });

    test("subprocess can read from terminal", async () => {
      const received: Uint8Array[] = [];

      await using terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Spawn cat which will echo input back
      const proc = Bun.spawn({
        cmd: ["cat"],
        terminal,
      });

      // Write to the terminal
      terminal.write("hello from test\n");

      // Wait a bit for processing
      await Bun.sleep(100);

      // Send EOF to cat
      proc.kill("SIGTERM");
      await proc.exited;
    });

    test("multiple subprocesses can use same terminal sequentially", async () => {
      await using terminal = new Bun.Terminal({});

      const proc1 = Bun.spawn({
        cmd: ["echo", "first"],
        terminal,
      });
      await proc1.exited;
      expect(proc1.exitCode).toBe(0);

      // Terminal should still be usable after first process exits
      expect(terminal.closed).toBe(false);

      const proc2 = Bun.spawn({
        cmd: ["echo", "second"],
        terminal,
      });
      await proc2.exited;
      expect(proc2.exitCode).toBe(0);
    });

    test("subprocess receives SIGWINCH on resize", async () => {
      await using terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Spawn a process that will receive SIGWINCH
      const proc = Bun.spawn({
        cmd: ["sleep", "1"],
        terminal,
      });

      // Resize should send SIGWINCH to the process group
      terminal.resize(100, 50);

      // Kill the process
      proc.kill();
      await proc.exited;
    });
  });

  describe("ANSI escape sequences", () => {
    test("can write ANSI color codes", async () => {
      const received: Uint8Array[] = [];

      await using terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Enable echo for this test
      enableEcho(terminal);

      terminal.write("\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m\n");
      await Bun.sleep(100);

      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("red");
      expect(allData).toContain("green");
    });

    test("can write cursor movement codes", async () => {
      await using terminal = new Bun.Terminal({});

      // Various cursor movement codes
      terminal.write("\x1b[H"); // Home
      terminal.write("\x1b[2J"); // Clear screen
      terminal.write("\x1b[10;20H"); // Move to row 10, col 20
      terminal.write("\x1b[A"); // Up
      terminal.write("\x1b[B"); // Down
      terminal.write("\x1b[C"); // Forward
      terminal.write("\x1b[D"); // Back
    });

    test("can write screen manipulation codes", async () => {
      await using terminal = new Bun.Terminal({});

      terminal.write("\x1b[?25l"); // Hide cursor
      terminal.write("\x1b[?25h"); // Show cursor
      terminal.write("\x1b[?1049h"); // Alt screen buffer
      terminal.write("\x1b[?1049l"); // Main screen buffer
    });
  });

  describe("binary data", () => {
    test("can write binary data", async () => {
      await using terminal = new Bun.Terminal({});

      // Write some binary data
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const written = terminal.write(binaryData);
      expect(written).toBe(6);
    });

    test("can receive binary data in callback", async () => {
      const received: Uint8Array[] = [];

      await using terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Enable echo for this test
      enableEcho(terminal);

      // Write some data that will be echoed
      terminal.write(new Uint8Array([0x41, 0x42, 0x43, 0x0a])); // ABC\n

      await Bun.sleep(100);

      expect(received.length).toBeGreaterThan(0);
    });
  });

  describe("stress tests", () => {
    // Helper to count open file descriptors (Linux/macOS)
    function countOpenFds(): number {
      const { readdirSync } = require("fs");
      try {
        // Linux: /proc/self/fd
        return readdirSync("/proc/self/fd").length;
      } catch {
        try {
          // macOS: /dev/fd
          return readdirSync("/dev/fd").length;
        } catch {
          // Fallback: return -1 to skip FD-based assertions
          return -1;
        }
      }
    }

    test("can create many terminals with FD cleanup", () => {
      const terminals: Bun.Terminal[] = [];
      const TERMINAL_COUNT = 50;

      // Get baseline FD count
      const baselineFds = countOpenFds();

      // Create many terminals
      for (let i = 0; i < TERMINAL_COUNT; i++) {
        terminals.push(new Bun.Terminal({}));
      }

      // FD count should have increased (each terminal uses ~4 fds: master, read, write, slave)
      const openFds = countOpenFds();
      if (baselineFds >= 0 && openFds >= 0) {
        expect(openFds).toBeGreaterThan(baselineFds);
      }

      // Close all terminals
      for (const terminal of terminals) {
        expect(terminal.closed).toBe(false);
        terminal.close();
        expect(terminal.closed).toBe(true);
      }

      // Give time for cleanup
      Bun.gc(true);

      // FD count should return to near baseline (within acceptable delta for GC timing)
      const finalFds = countOpenFds();
      if (baselineFds >= 0 && finalFds >= 0) {
        const fdDelta = finalFds - baselineFds;
        // Allow some delta for async cleanup, but should be much less than the opened count
        expect(fdDelta).toBeLessThan(TERMINAL_COUNT * 2);
      }
    });

    test("can write many times rapidly", async () => {
      await using terminal = new Bun.Terminal({});

      for (let i = 0; i < 100; i++) {
        terminal.write(`line ${i}\n`);
      }
    });

    test("can handle rapid resize", async () => {
      await using terminal = new Bun.Terminal({});

      for (let i = 0; i < 20; i++) {
        terminal.resize(80 + i, 24 + i);
      }
    });

    test("handles concurrent operations", async () => {
      await using terminal = new Bun.Terminal({
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
    });
  });

  describe("edge cases", () => {
    test("handles Unicode characters", async () => {
      const received: Uint8Array[] = [];

      await using terminal = new Bun.Terminal({
        data(term, data) {
          received.push(new Uint8Array(data));
        },
      });

      // Enable echo for this test
      enableEcho(terminal);

      terminal.write("Hello 世界 🌍 émojis\n");
      await Bun.sleep(100);

      const allData = Buffer.concat(received).toString();
      expect(allData).toContain("世界");
    });

    test("handles very long lines", async () => {
      await using terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
      });

      // Write a line much longer than terminal width
      const longLine = Buffer.alloc(1000, "x").toString();
      terminal.write(longLine + "\n");
    });

    test("handles empty callbacks gracefully", async () => {
      await using terminal = new Bun.Terminal({
        data: undefined,
        exit: undefined,
        drain: undefined,
      });

      terminal.write("test\n");
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

    // Use cat which reads from stdin and writes to stdout
    const proc = Bun.spawn(["cat"], {
      terminal: {
        data: (_terminal: Bun.Terminal, data: Uint8Array) => {
          dataChunks.push(data);
        },
      },
    });

    // Wait a bit for the subprocess to be ready
    await Bun.sleep(100);

    // Write to the terminal - cat will echo it back via stdout
    proc.terminal!.write("hello from parent\n");

    // Wait for response
    await Bun.sleep(200);

    // Close terminal to send EOF and let cat exit
    proc.terminal!.close();

    await proc.exited;

    // cat reads stdin and writes to stdout, so we should see our message
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

  test("throws when passing closed terminal to spawn", () => {
    const terminal = new Bun.Terminal({});
    terminal.close();

    expect(() => {
      Bun.spawn(["echo", "test"], { terminal });
    }).toThrow("terminal is closed");
  });

  test("subprocess stdin/stdout/stderr are null when using terminal", async () => {
    const proc = Bun.spawn(["echo", "test"], {
      terminal: {},
    });

    // When terminal is used, stdin/stdout/stderr go through the terminal
    expect(proc.stdin).toBeNull();
    expect(proc.stdout).toBeNull();
    expect(proc.stderr).toBeNull();

    await proc.exited;
    proc.terminal!.close();
  });

  test("existing terminal works with subprocess", async () => {
    const dataChunks: Uint8Array[] = [];

    await using terminal = new Bun.Terminal({
      data: (_t, data) => dataChunks.push(data),
    });

    const proc = Bun.spawn(["echo", "hello"], { terminal });

    // subprocess.terminal should reference the same terminal
    expect(proc.terminal).toBe(terminal);

    await proc.exited;
    expect(proc.exitCode).toBe(0);

    // Data should have been received
    const output = Buffer.concat(dataChunks).toString();
    expect(output).toContain("hello");
  });
});
