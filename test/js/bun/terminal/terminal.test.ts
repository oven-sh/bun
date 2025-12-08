import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("Bun.Terminal", () => {
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

      const largeData = "x".repeat(10000);
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
      await using terminal = new Bun.Terminal({});
      expect(terminal.closed).toBe(false);
      // terminal is auto-closed after this block
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
      const largeData = "x".repeat(10000) + "\n";
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
    test("drain callback exists", () => {
      let drainCalled = false;

      const terminal = new Bun.Terminal({
        drain(term) {
          drainCalled = true;
        },
      });

      // Write some data to potentially trigger drain
      terminal.write("hello");

      terminal.close();
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
      const longLine = "x".repeat(1000);
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
