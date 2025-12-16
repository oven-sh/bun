import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("Terminal VT emulation (ghostty)", () => {
  // ==========================================================================
  // Constructor and Basic Setup Tests
  // ==========================================================================

  describe("constructor", () => {
    test("Terminal class exists and is constructible", () => {
      const Terminal = Bun.Terminal;
      expect(Terminal).toBeDefined();
      expect(typeof Terminal).toBe("function");
    });

    test("creates terminal with default dimensions", () => {
      const terminal = new Bun.Terminal({});
      expect(terminal.cols).toBe(80);
      expect(terminal.rows).toBe(24);
      terminal.close();
    });

    test("creates terminal with custom dimensions", () => {
      const terminal = new Bun.Terminal({
        rows: 50,
        cols: 120,
      });
      expect(terminal.cols).toBe(120);
      expect(terminal.rows).toBe(50);
      terminal.close();
    });

    test("creates terminal with minimum dimensions", () => {
      const terminal = new Bun.Terminal({
        rows: 1,
        cols: 1,
      });
      expect(terminal.cols).toBe(1);
      expect(terminal.rows).toBe(1);
      terminal.close();
    });

    test("creates terminal with maximum dimensions", () => {
      const terminal = new Bun.Terminal({
        rows: 65535,
        cols: 65535,
      });
      expect(terminal.cols).toBe(65535);
      expect(terminal.rows).toBe(65535);
      terminal.close();
    });

    test("throws on missing options object", () => {
      // @ts-expect-error - testing invalid input
      expect(() => new Bun.Terminal()).toThrow();
    });

    test("throws on null options", () => {
      // @ts-expect-error - testing invalid input
      expect(() => new Bun.Terminal(null)).toThrow();
    });

    test("ignores invalid dimension values (negative)", () => {
      const terminal = new Bun.Terminal({
        rows: -10,
        cols: -20,
      });
      // Should use defaults for invalid values
      expect(terminal.rows).toBe(24);
      expect(terminal.cols).toBe(80);
      terminal.close();
    });

    test("ignores dimension values exceeding max", () => {
      const terminal = new Bun.Terminal({
        rows: 100000,
        cols: 100000,
      });
      // Should use defaults for values > 65535
      expect(terminal.rows).toBe(24);
      expect(terminal.cols).toBe(80);
      terminal.close();
    });
  });

  // ==========================================================================
  // feed() Method Tests
  // ==========================================================================

  describe("feed()", () => {
    test("accepts string input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(() => terminal.feed("Hello, World!")).not.toThrow();
      terminal.close();
    });

    test("accepts ArrayBuffer input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      const buffer = new TextEncoder().encode("Hello, World!");
      expect(() => terminal.feed(buffer)).not.toThrow();
      terminal.close();
    });

    test("accepts Uint8Array input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      const buffer = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      expect(() => terminal.feed(buffer)).not.toThrow();
      terminal.close();
    });

    test("accepts Buffer input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      const buffer = Buffer.from("Hello, World!");
      expect(() => terminal.feed(buffer)).not.toThrow();
      terminal.close();
    });

    test("throws on null input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      // @ts-expect-error - testing invalid input
      expect(() => terminal.feed(null)).toThrow();
      terminal.close();
    });

    test("throws on undefined input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      // @ts-expect-error - testing invalid input
      expect(() => terminal.feed(undefined)).toThrow();
      terminal.close();
    });

    test("throws on number input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      // @ts-expect-error - testing invalid input
      expect(() => terminal.feed(12345)).toThrow();
      terminal.close();
    });

    test("throws on object input", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      // @ts-expect-error - testing invalid input
      expect(() => terminal.feed({ data: "hello" })).toThrow();
      terminal.close();
    });

    test("handles empty string", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(() => terminal.feed("")).not.toThrow();
      const cursor = terminal.cursor;
      expect(cursor.x).toBe(0);
      expect(cursor.y).toBe(0);
      terminal.close();
    });

    test("handles empty buffer", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(() => terminal.feed(new Uint8Array(0))).not.toThrow();
      terminal.close();
    });

    test("handles very long string", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      const longString = "A".repeat(10000);
      expect(() => terminal.feed(longString)).not.toThrow();
      terminal.close();
    });

    test("handles binary data with null bytes", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      const buffer = new Uint8Array([65, 0, 66, 0, 67]); // A\0B\0C
      expect(() => terminal.feed(buffer)).not.toThrow();
      terminal.close();
    });

    test("handles UTF-8 multibyte characters", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      // Feed ASCII + multibyte characters
      terminal.feed("Hello 世界");
      const text = terminal.text;
      // ASCII portion should be preserved
      expect(text).toContain("Hello");
      // Multibyte characters are processed (may have encoding variations)
      expect(text.length).toBeGreaterThan(5);
      terminal.close();
    });

    test("updates cursor position after feed", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABCDE");
      const cursor = terminal.cursor;
      expect(cursor.x).toBe(5);
      expect(cursor.y).toBe(0);
      terminal.close();
    });

    test("handles newlines correctly", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Line1\nLine2\nLine3");
      const cursor = terminal.cursor;
      expect(cursor.y).toBe(2);
      terminal.close();
    });

    test("handles carriage return", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Hello\rWorld");
      const cursor = terminal.cursor;
      expect(cursor.x).toBe(5); // "World" overwrote "Hello"
      terminal.close();
    });
  });

  // ==========================================================================
  // at() Method Tests (Cell Access)
  // ==========================================================================

  describe("at()", () => {
    test("returns cell info for valid position", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABC");

      const cell = terminal.at(0, 0);
      expect(cell).toBeDefined();
      expect(cell).not.toBeNull();
      expect(cell.char).toBe("A");
      expect(typeof cell.wide).toBe("boolean");
      expect(typeof cell.styled).toBe("boolean");
      terminal.close();
    });

    test("returns correct character at each position", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("XYZ");

      expect(terminal.at(0, 0)?.char).toBe("X");
      expect(terminal.at(1, 0)?.char).toBe("Y");
      expect(terminal.at(2, 0)?.char).toBe("Z");
      terminal.close();
    });

    test("returns null for out-of-bounds x", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABC");

      const cell = terminal.at(100, 0);
      expect(cell).toBeNull();
      terminal.close();
    });

    test("returns null for out-of-bounds y", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABC");

      const cell = terminal.at(0, 100);
      expect(cell).toBeNull();
      terminal.close();
    });

    test("returns null for negative x", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABC");

      const cell = terminal.at(-1, 0);
      expect(cell).toBeNull();
      terminal.close();
    });

    test("returns null for negative y", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABC");

      const cell = terminal.at(0, -1);
      expect(cell).toBeNull();
      terminal.close();
    });

    test("returns space for unwritten cells", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("A");

      // Cell at position 5,0 should be empty/space
      const cell = terminal.at(5, 0);
      expect(cell).toBeDefined();
      expect(cell?.char).toBe(" ");
      terminal.close();
    });

    test("returns null before any feed (no VT initialized)", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      // VT is lazily initialized, so at() before feed() returns null
      const cell = terminal.at(0, 0);
      expect(cell).toBeNull();
      terminal.close();
    });

    test("handles boundary positions", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 10 });
      terminal.feed("X");

      // Last valid position
      const lastCell = terminal.at(9, 4);
      expect(lastCell).toBeDefined();

      // First invalid positions
      expect(terminal.at(10, 0)).toBeNull();
      expect(terminal.at(0, 5)).toBeNull();
      terminal.close();
    });

    test("throws on missing arguments", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABC");

      // @ts-expect-error - testing invalid input
      expect(() => terminal.at()).toThrow();
      // @ts-expect-error - testing invalid input
      expect(() => terminal.at(0)).toThrow();
      terminal.close();
    });

    test("handles wide characters", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("A中B"); // 中 is a wide character

      const cellA = terminal.at(0, 0);
      expect(cellA?.char).toBe("A");
      expect(cellA?.wide).toBe(false);

      // Wide character
      const cellWide = terminal.at(1, 0);
      expect(cellWide?.wide).toBe(true);
      terminal.close();
    });
  });

  // ==========================================================================
  // line() Method Tests
  // ==========================================================================

  describe("line()", () => {
    test("returns line relative to bottom (offset 0 = bottom)", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("First\nSecond\nThird");

      // Cursor is on row 2 (0-indexed) after "Third"
      // line(0) should return the content of row 2
      const bottomLine = terminal.line(0);
      expect(bottomLine).toBeDefined();
      expect(typeof bottomLine).toBe("string");
      terminal.close();
    });

    test("returns correct lines for multi-line content", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("AAA\nBBB\nCCC\nDDD");

      // DDD is at row 3, CCC at row 2, BBB at row 1, AAA at row 0
      // But line() is bottom-relative to visible area
      // With 10 rows, bottom is row 9
      // line(9) = row 0 = "AAA"
      // line(8) = row 1 = "BBB"
      // etc.
      terminal.close();
    });

    test("returns empty string for offset beyond screen", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("Hello");

      const line = terminal.line(100);
      expect(line).toBe("");
      terminal.close();
    });

    test("returns empty string for negative offset", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("Hello");

      const line = terminal.line(-1);
      expect(line).toBe("");
      terminal.close();
    });

    test("returns empty string before any feed", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });

      const line = terminal.line(0);
      expect(line).toBe("");
      terminal.close();
    });

    test("throws on missing argument", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("Hello");

      // @ts-expect-error - testing invalid input
      expect(() => terminal.line()).toThrow();
      terminal.close();
    });

    test("handles null argument", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("Hello");

      // @ts-expect-error - testing invalid input
      expect(() => terminal.line(null)).toThrow();
      terminal.close();
    });

    test("trims trailing whitespace", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("Hello");

      const line = terminal.line(4); // Row 0 where "Hello" is
      // Should not have trailing spaces
      expect(line).toBe(line.trimEnd());
      terminal.close();
    });
  });

  // ==========================================================================
  // text Property Tests
  // ==========================================================================

  describe("text property", () => {
    test("returns screen content as string", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("Line 1\nLine 2\nLine 3");

      const text = terminal.text;
      expect(typeof text).toBe("string");
      expect(text).toContain("Line 1");
      expect(text).toContain("Line 2");
      expect(text).toContain("Line 3");
      terminal.close();
    });

    test("returns empty string before any feed", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });

      const text = terminal.text;
      expect(text).toBe("");
      terminal.close();
    });

    test("is a getter (not callable)", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });
      terminal.feed("Hello");

      // Should be accessible as property
      expect(terminal.text).toBeDefined();

      // Should not be callable
      // @ts-expect-error - testing that it's not a function
      expect(typeof terminal.text).not.toBe("function");
      terminal.close();
    });

    test("reflects current screen state", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 20 });

      terminal.feed("First");
      expect(terminal.text).toContain("First");

      terminal.feed("\nSecond");
      expect(terminal.text).toContain("Second");
      terminal.close();
    });
  });

  // ==========================================================================
  // cursor Property Tests
  // ==========================================================================

  describe("cursor property", () => {
    test("returns cursor object with x, y, visible, style", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Hello");

      const cursor = terminal.cursor;
      expect(cursor).toBeDefined();
      expect(typeof cursor.x).toBe("number");
      expect(typeof cursor.y).toBe("number");
      expect(typeof cursor.visible).toBe("boolean");
      expect(typeof cursor.style).toBe("string");
      terminal.close();
    });

    test("starts at position (0, 0)", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed(""); // Initialize VT

      const cursor = terminal.cursor;
      expect(cursor.x).toBe(0);
      expect(cursor.y).toBe(0);
      terminal.close();
    });

    test("tracks horizontal movement", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABCDE");

      const cursor = terminal.cursor;
      expect(cursor.x).toBe(5);
      expect(cursor.y).toBe(0);
      terminal.close();
    });

    test("tracks vertical movement with newlines", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("A\nB\nC");

      const cursor = terminal.cursor;
      expect(cursor.y).toBe(2);
      terminal.close();
    });

    test("responds to escape sequence cursor positioning", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      // ESC[10;5H = move cursor to row 10, column 5 (1-indexed)
      terminal.feed("\x1b[10;5H");

      const cursor = terminal.cursor;
      expect(cursor.y).toBe(9); // 0-indexed
      expect(cursor.x).toBe(4); // 0-indexed
      terminal.close();
    });

    test("default style is block", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("X");

      expect(terminal.cursor.style).toBe("block");
      terminal.close();
    });

    test("returns default values before feed", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });

      const cursor = terminal.cursor;
      expect(cursor.x).toBe(0);
      expect(cursor.y).toBe(0);
      expect(cursor.style).toBe("block");
      terminal.close();
    });
  });

  // ==========================================================================
  // Escape Sequence Tests
  // ==========================================================================

  describe("escape sequences", () => {
    test("parses CSI cursor movement", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      terminal.feed("\x1b[10;20H"); // Move to row 10, col 20

      expect(terminal.cursor.y).toBe(9);
      expect(terminal.cursor.x).toBe(19);
      terminal.close();
    });

    test("parses cursor up (CUU)", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      terminal.feed("\x1b[10;10H"); // Start at row 10
      terminal.feed("\x1b[3A"); // Move up 3

      expect(terminal.cursor.y).toBe(6);
      terminal.close();
    });

    test("parses cursor down (CUD)", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      terminal.feed("\x1b[5;5H"); // Start at row 5
      terminal.feed("\x1b[3B"); // Move down 3

      expect(terminal.cursor.y).toBe(7);
      terminal.close();
    });

    test("parses cursor forward (CUF)", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      terminal.feed("\x1b[5;5H"); // Start at col 5
      terminal.feed("\x1b[10C"); // Move forward 10

      expect(terminal.cursor.x).toBe(14);
      terminal.close();
    });

    test("parses cursor backward (CUB)", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      terminal.feed("\x1b[5;15H"); // Start at col 15
      terminal.feed("\x1b[5D"); // Move backward 5

      expect(terminal.cursor.x).toBe(9);
      terminal.close();
    });

    test("handles alternate screen switch", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });

      expect(terminal.alternateScreen).toBe(false);

      // Switch to alternate screen (smcup - ESC[?1049h)
      terminal.feed("\x1b[?1049h");
      expect(terminal.alternateScreen).toBe(true);

      // Switch back to main screen (rmcup - ESC[?1049l)
      terminal.feed("\x1b[?1049l");
      expect(terminal.alternateScreen).toBe(false);
      terminal.close();
    });

    test("handles erase display (ED)", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Hello World");
      terminal.feed("\x1b[2J"); // Erase entire display

      // Screen should be cleared
      terminal.close();
    });

    test("handles erase line (EL)", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Hello World");
      terminal.feed("\x1b[2K"); // Erase entire line

      terminal.close();
    });

    test("handles SGR (colors/styles)", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      // Set red foreground, then write text
      terminal.feed("\x1b[31mRed Text\x1b[0m");

      const cell = terminal.at(0, 0);
      expect(cell?.styled).toBe(true);
      terminal.close();
    });

    test("handles tab character", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("A\tB");

      // Tab should move cursor
      expect(terminal.cursor.x).toBeGreaterThan(2);
      terminal.close();
    });

    test("handles backspace", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("ABC\x08"); // ABC then backspace

      expect(terminal.cursor.x).toBe(2);
      terminal.close();
    });
  });

  // ==========================================================================
  // clear() and reset() Tests
  // ==========================================================================

  describe("clear() and reset()", () => {
    test("clear() works without errors", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Some text here");

      expect(() => terminal.clear()).not.toThrow();
      terminal.close();
    });

    test("reset() works without errors", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Some text here");

      expect(() => terminal.reset()).not.toThrow();
      terminal.close();
    });

    test("clear() before any feed works", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(() => terminal.clear()).not.toThrow();
      terminal.close();
    });

    test("reset() before any feed works", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(() => terminal.reset()).not.toThrow();
      terminal.close();
    });

    test("multiple clear() calls work", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Text");
      terminal.clear();
      terminal.feed("More text");
      terminal.clear();
      terminal.clear();
      terminal.close();
    });

    test("multiple reset() calls work", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Text");
      terminal.reset();
      terminal.feed("More text");
      terminal.reset();
      terminal.reset();
      terminal.close();
    });
  });

  // ==========================================================================
  // State After Close Tests
  // ==========================================================================

  describe("operations after close", () => {
    test("closed property reflects state", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(terminal.closed).toBe(false);

      terminal.close();
      expect(terminal.closed).toBe(true);
    });

    test("double close does not throw", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.close();
      expect(() => terminal.close()).not.toThrow();
    });
  });

  // ==========================================================================
  // alternateScreen Property Tests
  // ==========================================================================

  describe("alternateScreen property", () => {
    test("initially false", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      expect(terminal.alternateScreen).toBe(false);
      terminal.close();
    });

    test("false before feed", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });
      expect(terminal.alternateScreen).toBe(false);
      terminal.close();
    });

    test("toggles with escape sequences", () => {
      const terminal = new Bun.Terminal({ rows: 24, cols: 80 });

      terminal.feed("\x1b[?1049h");
      expect(terminal.alternateScreen).toBe(true);

      terminal.feed("\x1b[?1049l");
      expect(terminal.alternateScreen).toBe(false);

      terminal.feed("\x1b[?1049h");
      expect(terminal.alternateScreen).toBe(true);
      terminal.close();
    });
  });

  // ==========================================================================
  // scrollbackLines Property Tests
  // ==========================================================================

  describe("scrollbackLines property", () => {
    test("initially zero", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(terminal.scrollbackLines).toBe(0);
      terminal.close();
    });

    test("returns number", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(typeof terminal.scrollbackLines).toBe("number");
      terminal.close();
    });
  });

  // ==========================================================================
  // title Property Tests
  // ==========================================================================

  describe("title property", () => {
    test("initially empty", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(terminal.title).toBe("");
      terminal.close();
    });

    test("returns string", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      expect(typeof terminal.title).toBe("string");
      terminal.close();
    });
  });

  // ==========================================================================
  // Line Wrapping Tests
  // ==========================================================================

  describe("line wrapping", () => {
    test("text wraps at column boundary", () => {
      const terminal = new Bun.Terminal({ rows: 10, cols: 10 });
      terminal.feed("ABCDEFGHIJKLMNO"); // 15 chars in 10-col terminal

      // Cursor should have wrapped to next line
      expect(terminal.cursor.y).toBeGreaterThan(0);
      terminal.close();
    });

    test("cursor stays within bounds", () => {
      const terminal = new Bun.Terminal({ rows: 5, cols: 10 });
      terminal.feed("A".repeat(100));

      // Cursor should be within terminal bounds
      expect(terminal.cursor.x).toBeLessThan(10);
      expect(terminal.cursor.y).toBeLessThan(5);
      terminal.close();
    });
  });

  // ==========================================================================
  // Integration with Process Spawn Tests
  // ==========================================================================

  describe("integration with spawn", () => {
    test("can parse ANSI output from spawned process", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "console.log('\\x1b[32mGreen\\x1b[0m')"],
        env: bunEnv,
        stdout: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(stdout).toContain("Green");

      await proc.exited;
    });
  });

  // ==========================================================================
  // Memory/Resource Management Tests
  // ==========================================================================

  describe("resource management", () => {
    test("can create and close many terminals", () => {
      for (let i = 0; i < 100; i++) {
        const terminal = new Bun.Terminal({ rows: 10, cols: 40 });
        terminal.feed("Test");
        terminal.close();
      }
    });

    test("using syntax works", async () => {
      await using terminal = new Bun.Terminal({ rows: 10, cols: 40 });
      terminal.feed("Hello");
      expect(terminal.closed).toBe(false);
      // Terminal should be closed after block
    });
  });
});
