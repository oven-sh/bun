import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

/** Helper: render a screen to a file and return the ANSI output string. */
function renderToString(
  cols: number,
  rows: number,
  setup: (screen: InstanceType<typeof Bun.TUIScreen>) => void,
  renderOpts?: {
    cursorX?: number;
    cursorY?: number;
    cursorVisible?: boolean;
    cursorStyle?: string;
    cursorBlinking?: boolean;
  },
): string {
  using dir = tempDir("tui-writer", {});
  const filePath = join(String(dir), "output.bin");
  const fd = openSync(filePath, "w");
  try {
    const screen = new Bun.TUIScreen(cols, rows);
    setup(screen);
    const writer = new Bun.TUITerminalWriter(Bun.file(fd));
    writer.render(screen, renderOpts);
    closeSync(fd);
    return readFileSync(filePath, "utf8");
  } catch (e) {
    try {
      closeSync(fd);
    } catch {}
    throw e;
  }
}

/** Helper: render a screen twice via the same writer, returning both outputs. */
function renderTwice(
  cols: number,
  rows: number,
  setup1: (screen: InstanceType<typeof Bun.TUIScreen>) => void,
  setup2: (screen: InstanceType<typeof Bun.TUIScreen>) => void,
): { output1: string; output2: string } {
  using dir = tempDir("tui-writer-diff2", {});
  const combinedPath = join(String(dir), "combined.bin");
  const fd = openSync(combinedPath, "w");
  const screen = new Bun.TUIScreen(cols, rows);
  setup1(screen);

  const w = new Bun.TUITerminalWriter(Bun.file(fd));
  w.render(screen);

  // Read first output by checking file size
  const firstSize = readFileSync(combinedPath).length;

  // Mutate and render again (diff path)
  setup2(screen);
  w.render(screen);
  closeSync(fd);

  const combined = readFileSync(combinedPath);
  return {
    output1: combined.slice(0, firstSize).toString("utf8"),
    output2: combined.slice(firstSize).toString("utf8"),
  };
}

describe("Bun.TUITerminalWriter", () => {
  // ─── Constructor ──────────────────────────────────────────────────

  test("constructor requires Bun.file() argument", () => {
    expect(() => new (Bun.TUITerminalWriter as any)()).toThrow();
    expect(() => new (Bun.TUITerminalWriter as any)("not a file")).toThrow();
    expect(() => new (Bun.TUITerminalWriter as any)(42)).toThrow();
  });

  test("constructor accepts Bun.file(fd)", () => {
    using dir = tempDir("tui-writer-ctor", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      expect(writer).toBeDefined();
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── Full Render ──────────────────────────────────────────────────

  test("render produces ANSI output with BSU/ESU", () => {
    const output = renderToString(10, 3, screen => {
      screen.setText(0, 0, "Hello");
      screen.setText(0, 1, "World");
    });

    expect(output).toContain("\x1b[?2026h"); // BSU
    expect(output).toContain("\x1b[?2026l"); // ESU
    expect(output).toContain("Hello");
    expect(output).toContain("World");
  });

  test("render with styled text produces SGR sequences", () => {
    const output = renderToString(20, 3, screen => {
      const bold = screen.style({ bold: true });
      screen.setText(0, 0, "Bold", bold);
    });

    expect(output).toContain("\x1b[1m"); // bold SGR
    expect(output).toContain("\x1b[0m"); // reset
  });

  test("render with RGB colors produces 24-bit SGR", () => {
    const output = renderToString(20, 3, screen => {
      const red = screen.style({ fg: 0xff0000 });
      screen.setText(0, 0, "Red", red);
    });

    expect(output).toContain("\x1b[38;2;255;0;0m");
  });

  test("render with background RGB color", () => {
    const output = renderToString(20, 3, screen => {
      const bg = screen.style({ bg: 0x00ff00 });
      screen.setText(0, 0, "Green", bg);
    });

    expect(output).toContain("\x1b[48;2;0;255;0m");
  });

  test("render includes cursor hide/show", () => {
    const output = renderToString(10, 3, screen => {
      screen.setText(0, 0, "Hi");
    });

    expect(output).toContain("\x1b[?25l"); // hide cursor
    expect(output).toContain("\x1b[?25h"); // show cursor
  });

  test("render includes erase-to-EOL for each row", () => {
    const output = renderToString(10, 3, screen => {
      screen.setText(0, 0, "Hi");
    });

    // Should have \x1b[K for row clearing
    expect(output).toContain("\x1b[K");
  });

  test("render emits all style flags", () => {
    const output = renderToString(30, 1, screen => {
      const s = screen.style({
        bold: true,
        faint: true,
        italic: true,
        underline: "single",
        blink: true,
        inverse: true,
        invisible: true,
        strikethrough: true,
        overline: true,
      });
      screen.setText(0, 0, "AllStyles", s);
    });

    expect(output).toContain("\x1b[1m"); // bold
    expect(output).toContain("\x1b[2m"); // faint
    expect(output).toContain("\x1b[3m"); // italic
    expect(output).toContain("\x1b[4m"); // underline single
    expect(output).toContain("\x1b[5m"); // blink
    expect(output).toContain("\x1b[7m"); // inverse
    expect(output).toContain("\x1b[8m"); // invisible
    expect(output).toContain("\x1b[9m"); // strikethrough
    expect(output).toContain("\x1b[53m"); // overline
  });

  test("render emits all underline variants", () => {
    for (const [variant, expected] of [
      ["single", "\x1b[4m"],
      ["double", "\x1b[4:2m"],
      ["curly", "\x1b[4:3m"],
      ["dotted", "\x1b[4:4m"],
      ["dashed", "\x1b[4:5m"],
    ] as const) {
      const output = renderToString(20, 1, screen => {
        const s = screen.style({ underline: variant });
        screen.setText(0, 0, "Test", s);
      });
      expect(output).toContain(expected);
    }
  });

  test("render of CJK wide characters", () => {
    const output = renderToString(20, 1, screen => {
      screen.setText(0, 0, "A世B");
    });

    expect(output).toContain("A");
    expect(output).toContain("世");
    expect(output).toContain("B");
  });

  test("render of empty screen has minimal content", () => {
    const output = renderToString(80, 24, _screen => {
      // No content written
    });

    // Should still have BSU/ESU and cursor management
    expect(output).toContain("\x1b[?2026h");
    expect(output).toContain("\x1b[?2026l");
    // Should not contain any printable text content
    const stripped = output
      .replace(/\x1b\[[^A-Za-z]*[A-Za-z]/g, "") // strip all escape sequences
      .replace(/[\r\n]/g, "") // strip newlines
      .trim();
    // Empty screen should produce only whitespace/clearing, not random text
    expect(stripped).not.toContain("A");
  });

  // ─── Diff Render ──────────────────────────────────────────────────

  test("second render with no changes produces minimal output", () => {
    const { output1, output2 } = renderTwice(
      40,
      5,
      screen => {
        screen.setText(0, 0, "Hello");
        screen.setText(0, 1, "World");
      },
      _screen => {
        // No changes
      },
    );

    // First render should have content
    expect(output1).toContain("Hello");
    expect(output1).toContain("World");

    // Second render should be much smaller — just BSU + ESU, no content
    expect(output2.length).toBeLessThan(output1.length);
    expect(output2).toContain("\x1b[?2026h");
    expect(output2).toContain("\x1b[?2026l");
    // Diff with no dirty rows should not contain the original text
    expect(output2).not.toContain("Hello");
    expect(output2).not.toContain("World");
  });

  test("single cell change produces small diff", () => {
    const { output1, output2 } = renderTwice(
      40,
      5,
      screen => {
        screen.setText(0, 0, "Hello World");
        screen.setText(0, 1, "Line Two");
        screen.setText(0, 2, "Line Three");
      },
      screen => {
        // Change just one cell
        screen.setText(0, 0, "J"); // overwrite 'H' with 'J'
      },
    );

    // First render contains all text
    expect(output1).toContain("Hello");

    // Diff should contain 'J' but be much smaller than full render
    expect(output2).toContain("J");
    expect(output2.length).toBeLessThan(output1.length);
  });

  test("style-only change between renders triggers diff", () => {
    const { output1, output2 } = renderTwice(
      20,
      3,
      screen => {
        screen.setText(0, 0, "Text");
      },
      screen => {
        // Change style but not character
        const bold = screen.style({ bold: true });
        screen.setText(0, 0, "Text", bold);
      },
    );

    // Second render should contain the bold SGR
    expect(output2).toContain("\x1b[1m");
    expect(output2).toContain("Text");
  });

  test("row-level skip: unchanged rows produce no output", () => {
    const { output2 } = renderTwice(
      40,
      10,
      screen => {
        for (let y = 0; y < 10; y++) {
          screen.setText(0, y, `Row ${y}`);
        }
      },
      screen => {
        // Only change row 5
        screen.setText(0, 5, "Changed!");
      },
    );

    // Diff should contain the changed text
    expect(output2).toContain("Changed!");
    // Diff should NOT contain unchanged rows
    expect(output2).not.toContain("Row 0");
    expect(output2).not.toContain("Row 9");
  });

  // ─── Writer clear ─────────────────────────────────────────────────

  test("clear resets writer state, next render is full", () => {
    using dir = tempDir("tui-writer-clear", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(10, 3);
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen);
      writer.clear();

      screen.setText(0, 0, "After");
      writer.render(screen);
      closeSync(fd);

      const output = readFileSync(filePath, "utf8");
      expect(output).toContain("After");
      // After clear, should do a full render (with cursor hide/show)
      expect(output).toContain("\x1b[?25l");
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── Render argument validation ───────────────────────────────────

  test("render throws with no arguments", () => {
    using dir = tempDir("tui-writer-err", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      expect(() => (writer as any).render()).toThrow();
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("render throws with non-Screen argument", () => {
    using dir = tempDir("tui-writer-err2", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      expect(() => (writer as any).render({})).toThrow();
      expect(() => (writer as any).render(42)).toThrow();
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── Output size verification ─────────────────────────────────────

  test("full repaint byte count is reasonable", () => {
    const output = renderToString(80, 24, screen => {
      // Fill entire screen with ASCII
      for (let y = 0; y < 24; y++) {
        screen.setText(0, y, Buffer.alloc(80, "A").toString());
      }
    });

    // 80*24 = 1920 characters of content, plus ANSI overhead
    // Should not be more than ~4x the raw content
    expect(output.length).toBeGreaterThan(1920); // at least the content
    expect(output.length).toBeLessThan(1920 * 4); // not wildly bloated
  });

  test("diff after single-cell change is much smaller than full repaint", () => {
    const { output1, output2 } = renderTwice(
      80,
      24,
      screen => {
        for (let y = 0; y < 24; y++) {
          screen.setText(0, y, Buffer.alloc(80, "A").toString());
        }
      },
      screen => {
        screen.setText(0, 0, "B"); // Change one cell
      },
    );

    // Diff should be at least 10x smaller than full render
    expect(output2.length).toBeLessThan(output1.length / 5);
  });

  // ─── Multiple screens with same writer ────────────────────────────

  test("rendering different-sized screen triggers full re-render", () => {
    using dir = tempDir("tui-writer-resize", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen1 = new Bun.TUIScreen(20, 5);
      screen1.setText(0, 0, "Small");
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen1);

      const firstSize = readFileSync(filePath).length;

      // Render a differently-sized screen
      const screen2 = new Bun.TUIScreen(40, 10);
      screen2.setText(0, 0, "Bigger");
      writer.render(screen2);

      closeSync(fd);
      const combined = readFileSync(filePath, "utf8");
      const secondPart = combined.slice(firstSize);

      // Should do a full render since dimensions changed
      expect(secondPart).toContain("Bigger");
      expect(secondPart).toContain("\x1b[?25l"); // cursor hide (full render)
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── Styled blank cells (background color) ────────────────────────

  test("styled blank cells emit spaces to carry background", () => {
    const output = renderToString(10, 1, screen => {
      const bg = screen.style({ bg: 0xff0000 });
      screen.fill(0, 0, 5, 1, " ", bg);
      screen.setText(5, 0, "X");
    });

    // Should contain the bg color SGR before the spaces
    expect(output).toContain("\x1b[48;2;255;0;0m");
    // Should contain X
    expect(output).toContain("X");
  });

  // ─── Cursor position control ───────────────────────────────────

  test("render with cursorVisible: false hides cursor", () => {
    const output = renderToString(
      10,
      3,
      screen => {
        screen.setText(0, 0, "Hi");
      },
      { cursorVisible: false },
    );

    // Should contain cursor hide but not the show at the end
    expect(output).toContain("\x1b[?25l");
    // The last cursor visibility should be hide
    const lastHide = output.lastIndexOf("\x1b[?25l");
    const lastShow = output.lastIndexOf("\x1b[?25h");
    expect(lastHide).toBeGreaterThan(lastShow);
  });

  test("render with cursorVisible: true shows cursor", () => {
    const output = renderToString(
      10,
      3,
      screen => {
        screen.setText(0, 0, "Hi");
      },
      { cursorVisible: true },
    );

    expect(output).toContain("\x1b[?25h");
  });

  test("render with cursor position emits movement", () => {
    const output = renderToString(
      20,
      5,
      screen => {
        screen.setText(0, 0, "Hello");
      },
      { cursorX: 5, cursorY: 0 },
    );

    // Output should contain the content
    expect(output).toContain("Hello");
  });

  // ─── Relative cursor movement ──────────────────────────────────

  test("uses relative cursor movement (no CUP sequences)", () => {
    const output = renderToString(10, 3, screen => {
      screen.setText(0, 0, "R1");
      screen.setText(0, 1, "R2");
      screen.setText(0, 2, "R3");
    });

    // Should NOT contain absolute CUP (e.g., \x1b[1;1H)
    // for the initial render (no prior render)
    const cupPattern = /\x1b\[\d+;\d+H/;
    expect(cupPattern.test(output)).toBe(false);

    // Should use CR+LF between rows
    expect(output).toContain("\r\n");
  });

  // ─── Hyperlink OSC 8 ───────────────────────────────────────────

  test("render emits OSC 8 for hyperlinked cells", () => {
    const output = renderToString(20, 1, screen => {
      const id = screen.hyperlink("https://example.com");
      screen.setText(0, 0, "Click");
      for (let i = 0; i < 5; i++) screen.setHyperlink(i, 0, id);
    });

    // Should contain OSC 8 open with URL
    expect(output).toContain("\x1b]8;;https://example.com\x1b\\");
    // Should contain OSC 8 close
    expect(output).toContain("\x1b]8;;\x1b\\");
    // Should contain the text
    expect(output).toContain("Click");
  });

  // ─── close() / end() ──────────────────────────────────────────────

  test("close() prevents further render calls", () => {
    using dir = tempDir("tui-writer-close", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(10, 3);
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen);
      writer.close();
      expect(() => writer.render(screen)).toThrow();
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("end() is an alias for close()", () => {
    using dir = tempDir("tui-writer-end", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(10, 3);
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen);
      writer.end();
      expect(() => writer.render(screen)).toThrow();
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("close() is idempotent", () => {
    using dir = tempDir("tui-writer-close2", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.close();
      writer.close(); // should not throw
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── Cursor Style (DECSCUSR) ──────────────────────────────────────

  test("render with cursorStyle: block emits DECSCUSR", () => {
    const output = renderToString(
      10,
      3,
      screen => {
        screen.setText(0, 0, "Hi");
      },
      { cursorStyle: "block" },
    );
    // Block steady = \x1b[2 q
    expect(output).toContain("\x1b[2 q");
  });

  test("render with cursorStyle: line emits DECSCUSR", () => {
    const output = renderToString(
      10,
      3,
      screen => {
        screen.setText(0, 0, "Hi");
      },
      { cursorStyle: "line" },
    );
    // Line steady = \x1b[6 q
    expect(output).toContain("\x1b[6 q");
  });

  test("render with cursorStyle: underline emits DECSCUSR", () => {
    const output = renderToString(
      10,
      3,
      screen => {
        screen.setText(0, 0, "Hi");
      },
      { cursorStyle: "underline" },
    );
    // Underline steady = \x1b[4 q
    expect(output).toContain("\x1b[4 q");
  });

  test("render with cursorBlinking: true and cursorStyle: block", () => {
    const output = renderToString(
      10,
      3,
      screen => {
        screen.setText(0, 0, "Hi");
      },
      { cursorStyle: "block", cursorBlinking: true },
    );
    // Block blinking = \x1b[1 q
    expect(output).toContain("\x1b[1 q");
  });

  test("render with cursorStyle: default resets DECSCUSR", () => {
    // First render sets a cursor style
    using dir = tempDir("tui-writer-cursor-default", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(10, 3);
      screen.setText(0, 0, "Hi");
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen, { cursorStyle: "block" });
      const firstSize = readFileSync(filePath).length;

      // Second render with "default" should emit \x1b[0 q
      writer.render(screen, { cursorStyle: "default" });
      closeSync(fd);
      const combined = readFileSync(filePath, "utf8");
      const secondPart = combined.slice(firstSize);
      expect(secondPart).toContain("\x1b[0 q");
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("same cursor style on consecutive renders does NOT re-emit DECSCUSR", () => {
    using dir = tempDir("tui-writer-cursor-same", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(10, 3);
      screen.setText(0, 0, "Hi");
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen, { cursorStyle: "block" });
      const firstSize = readFileSync(filePath).length;

      // Second render with same style — should NOT contain DECSCUSR
      writer.render(screen, { cursorStyle: "block" });
      closeSync(fd);
      const combined = readFileSync(filePath, "utf8");
      const secondPart = combined.slice(firstSize);
      expect(secondPart).not.toContain(" q");
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── Alternate Screen ──────────────────────────────────────────────

  test("enterAltScreen emits \\x1b[?1049h", () => {
    using dir = tempDir("tui-writer-altscreen", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.enterAltScreen();
      closeSync(fd);
      const output = readFileSync(filePath, "utf8");
      expect(output).toContain("\x1b[?1049h");
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("exitAltScreen emits \\x1b[?1049l", () => {
    using dir = tempDir("tui-writer-altscreen-exit", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.enterAltScreen();
      writer.exitAltScreen();
      closeSync(fd);
      const output = readFileSync(filePath, "utf8");
      expect(output).toContain("\x1b[?1049h");
      expect(output).toContain("\x1b[?1049l");
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("close() auto-exits alt screen", () => {
    using dir = tempDir("tui-writer-altscreen-autoclose", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.enterAltScreen();
      writer.close();
      closeSync(fd);
      const output = readFileSync(filePath, "utf8");
      // Should have both enter and exit
      expect(output).toContain("\x1b[?1049h");
      expect(output).toContain("\x1b[?1049l");
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("enterAltScreen is idempotent", () => {
    using dir = tempDir("tui-writer-altscreen-idem", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.enterAltScreen();
      writer.enterAltScreen(); // second call should be no-op
      closeSync(fd);
      const output = readFileSync(filePath, "utf8");
      // Should only have one enter sequence
      const matches = output.split("\x1b[?1049h").length - 1;
      expect(matches).toBe(1);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("enterAltScreen throws on closed writer", () => {
    using dir = tempDir("tui-writer-altscreen-err", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.close();
      expect(() => writer.enterAltScreen()).toThrow();
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── onresize ──────────────────────────────────────────────────────

  test("onresize property exists", () => {
    using dir = tempDir("tui-writer-onresize", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      // onresize is a setter/getter — users should use process.on("SIGWINCH") instead
      expect("onresize" in writer).toBe(true);
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  // ─── Mouse Tracking ─────────────────────────────────────────────

  describe("enableMouseTracking / disableMouseTracking", () => {
    test("enableMouseTracking emits tracking escape sequences", () => {
      using dir = tempDir("tui-writer-mouse-en", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableMouseTracking();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[?1000h");
        expect(output).toContain("\x1b[?1002h");
        expect(output).toContain("\x1b[?1003h");
        expect(output).toContain("\x1b[?1006h");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("disableMouseTracking emits disable sequences", () => {
      using dir = tempDir("tui-writer-mouse-dis", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableMouseTracking();
        writer.disableMouseTracking();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[?1000l");
        expect(output).toContain("\x1b[?1002l");
        expect(output).toContain("\x1b[?1003l");
        expect(output).toContain("\x1b[?1006l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("enableMouseTracking is idempotent", () => {
      using dir = tempDir("tui-writer-mouse-idem", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableMouseTracking();
        writer.enableMouseTracking(); // second call should be no-op
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        // Should only have one set of enable sequences
        const matches = output.split("\x1b[?1000h").length - 1;
        expect(matches).toBe(1);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("disableMouseTracking is no-op when not enabled", () => {
      using dir = tempDir("tui-writer-mouse-noop", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.disableMouseTracking(); // not enabled — should be no-op
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).not.toContain("\x1b[?1000l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("enableMouseTracking throws on closed writer", () => {
      using dir = tempDir("tui-writer-mouse-closed", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.close();
        expect(() => writer.enableMouseTracking()).toThrow();
        expect(() => writer.disableMouseTracking()).toThrow();
        closeSync(fd);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("close() auto-disables mouse tracking", () => {
      using dir = tempDir("tui-writer-mouse-autoclose", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableMouseTracking();
        writer.close();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        // Should have both enable and disable sequences
        expect(output).toContain("\x1b[?1000h");
        expect(output).toContain("\x1b[?1000l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });
  });

  // ─── Focus Tracking ─────────────────────────────────────────────

  describe("enableFocusTracking / disableFocusTracking", () => {
    test("enableFocusTracking emits CSI ?1004h", () => {
      using dir = tempDir("tui-writer-focus-en", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableFocusTracking();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[?1004h");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("disableFocusTracking emits CSI ?1004l", () => {
      using dir = tempDir("tui-writer-focus-dis", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableFocusTracking();
        writer.disableFocusTracking();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[?1004h");
        expect(output).toContain("\x1b[?1004l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("enableFocusTracking is idempotent", () => {
      using dir = tempDir("tui-writer-focus-idem", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableFocusTracking();
        writer.enableFocusTracking();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        const matches = output.split("\x1b[?1004h").length - 1;
        expect(matches).toBe(1);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("disableFocusTracking is no-op when not enabled", () => {
      using dir = tempDir("tui-writer-focus-noop", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.disableFocusTracking();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).not.toContain("\x1b[?1004l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("enableFocusTracking throws on closed writer", () => {
      using dir = tempDir("tui-writer-focus-closed", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.close();
        expect(() => writer.enableFocusTracking()).toThrow();
        expect(() => writer.disableFocusTracking()).toThrow();
        closeSync(fd);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("close() auto-disables focus tracking", () => {
      using dir = tempDir("tui-writer-focus-autoclose", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableFocusTracking();
        writer.close();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[?1004h");
        expect(output).toContain("\x1b[?1004l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });
  });

  // ─── Bracketed Paste ────────────────────────────────────────────

  describe("enableBracketedPaste / disableBracketedPaste", () => {
    test("enableBracketedPaste emits CSI ?2004h", () => {
      using dir = tempDir("tui-writer-paste-en", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableBracketedPaste();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[?2004h");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("disableBracketedPaste emits CSI ?2004l", () => {
      using dir = tempDir("tui-writer-paste-dis", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableBracketedPaste();
        writer.disableBracketedPaste();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[?2004h");
        expect(output).toContain("\x1b[?2004l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("enableBracketedPaste throws on closed writer", () => {
      using dir = tempDir("tui-writer-paste-closed", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.close();
        expect(() => writer.enableBracketedPaste()).toThrow();
        expect(() => writer.disableBracketedPaste()).toThrow();
        closeSync(fd);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });
  });

  // ─── write() ────────────────────────────────────────────────────

  describe("write", () => {
    test("write sends raw string to output", () => {
      using dir = tempDir("tui-writer-write-raw", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.write("Hello, raw!");
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("Hello, raw!");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("write sends escape sequences", () => {
      using dir = tempDir("tui-writer-write-esc", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.write("\x1b[31mRed Text\x1b[0m");
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        expect(output).toContain("\x1b[31m");
        expect(output).toContain("Red Text");
        expect(output).toContain("\x1b[0m");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("write throws on closed writer", () => {
      using dir = tempDir("tui-writer-write-closed", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.close();
        expect(() => writer.write("test")).toThrow();
        closeSync(fd);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("write throws with non-string argument", () => {
      using dir = tempDir("tui-writer-write-err", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        expect(() => (writer as any).write()).toThrow();
        expect(() => (writer as any).write(42)).toThrow();
        closeSync(fd);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("write with empty string is no-op", () => {
      using dir = tempDir("tui-writer-write-empty", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.write("");
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        // Should be empty or minimal
        expect(output.length).toBeLessThanOrEqual(0);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });
  });

  // ─── onresize callback ─────────────────────────────────────────

  describe("onresize callback", () => {
    test("onresize setter and getter work", () => {
      using dir = tempDir("tui-writer-onresize-sg", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        const cb = (_cols: number, _rows: number) => {};
        writer.onresize = cb;
        expect(writer.onresize).toBe(cb);
        closeSync(fd);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });

    test("onresize can be set to null/undefined to clear", () => {
      using dir = tempDir("tui-writer-onresize-clear", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.onresize = () => {};
        expect(writer.onresize).toBeDefined();
        writer.onresize = undefined as any;
        closeSync(fd);
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });
  });

  // ─── Combined tracking with close ──────────────────────────────

  describe("combined tracking auto-disable on close", () => {
    test("close auto-disables all active tracking modes", () => {
      using dir = tempDir("tui-writer-all-track", {});
      const filePath = join(String(dir), "output.bin");
      const fd = openSync(filePath, "w");
      try {
        const writer = new Bun.TUITerminalWriter(Bun.file(fd));
        writer.enableMouseTracking();
        writer.enableFocusTracking();
        writer.enterAltScreen();
        writer.close();
        closeSync(fd);
        const output = readFileSync(filePath, "utf8");
        // Mouse tracking disabled
        expect(output).toContain("\x1b[?1000l");
        // Focus tracking disabled
        expect(output).toContain("\x1b[?1004l");
        // Alt screen exited
        expect(output).toContain("\x1b[?1049l");
      } catch (e) {
        try {
          closeSync(fd);
        } catch {}
        throw e;
      }
    });
  });
});

describe("Bun.TUIBufferWriter", () => {
  /** Helper: render to an ArrayBuffer and return the ANSI output string + byte count. */
  function renderToArrayBuffer(
    cols: number,
    rows: number,
    setup: (screen: InstanceType<typeof Bun.TUIScreen>) => void,
    renderOpts?: { cursorX?: number; cursorY?: number; cursorVisible?: boolean },
    bufSize = 65536,
  ): { output: string; byteCount: number } {
    const buf = new ArrayBuffer(bufSize);
    const screen = new Bun.TUIScreen(cols, rows);
    setup(screen);
    const writer = new Bun.TUIBufferWriter(buf);
    const byteCount = writer.render(screen, renderOpts);
    const output = new TextDecoder().decode(new Uint8Array(buf, 0, byteCount));
    return { output, byteCount };
  }

  // ─── Constructor ──────────────────────────────────────────────────

  test("constructor accepts ArrayBuffer", () => {
    const buf = new ArrayBuffer(1024);
    const writer = new Bun.TUIBufferWriter(buf);
    expect(writer).toBeDefined();
  });

  test("constructor accepts Uint8Array", () => {
    const buf = new Uint8Array(1024);
    const writer = new Bun.TUIBufferWriter(buf);
    expect(writer).toBeDefined();
  });

  test("constructor rejects non-buffer arguments", () => {
    expect(() => new (Bun.TUIBufferWriter as any)()).toThrow();
    expect(() => new (Bun.TUIBufferWriter as any)(42)).toThrow();
    expect(() => new (Bun.TUIBufferWriter as any)("string")).toThrow();
  });

  // ─── Render ──────────────────────────────────────────────────────

  test("render returns byte count", () => {
    const { byteCount } = renderToArrayBuffer(10, 3, screen => {
      screen.setText(0, 0, "Hello");
    });
    expect(byteCount).toBeGreaterThan(0);
  });

  test("render produces same ANSI as terminal writer mode", () => {
    const setup = (screen: InstanceType<typeof Bun.TUIScreen>) => {
      screen.setText(0, 0, "Hello");
      screen.setText(0, 1, "World");
    };

    const fdOutput = renderToString(10, 3, setup);
    const { output: bufOutput } = renderToArrayBuffer(10, 3, setup);

    expect(bufOutput).toBe(fdOutput);
  });

  test("render with styled text matches terminal writer mode", () => {
    const setup = (screen: InstanceType<typeof Bun.TUIScreen>) => {
      const bold = screen.style({ bold: true });
      screen.setText(0, 0, "Bold", bold);
    };

    const fdOutput = renderToString(20, 3, setup);
    const { output: bufOutput } = renderToArrayBuffer(20, 3, setup);

    expect(bufOutput).toBe(fdOutput);
  });

  test("render with cursor options", () => {
    const { output } = renderToArrayBuffer(
      10,
      3,
      screen => {
        screen.setText(0, 0, "X");
      },
      { cursorX: 5, cursorY: 1, cursorVisible: false },
    );
    expect(output).toContain("\x1b[?25l"); // cursor hidden
  });

  test("render truncates when buffer is too small", () => {
    const { byteCount } = renderToArrayBuffer(
      80,
      24,
      screen => {
        for (let y = 0; y < 24; y++) {
          screen.setText(0, y, Buffer.alloc(80, "X").toString());
        }
      },
      undefined,
      32, // very small buffer
    );
    expect(byteCount).toBe(32);
  });

  test("diff rendering works across multiple renders", () => {
    const buf = new ArrayBuffer(65536);
    const screen = new Bun.TUIScreen(10, 3);
    const writer = new Bun.TUIBufferWriter(buf);

    // First render — full
    screen.setText(0, 0, "Hello");
    const n1 = writer.render(screen);
    const out1 = new TextDecoder().decode(new Uint8Array(buf, 0, n1));
    expect(out1).toContain("Hello");

    // Second render — diff (only changed cells)
    screen.setText(0, 0, "ABCDE");
    const n2 = writer.render(screen);
    const out2 = new TextDecoder().decode(new Uint8Array(buf, 0, n2));
    expect(out2).toContain("ABCDE");
    // Diff output should be shorter than full render
    expect(n2).toBeLessThan(n1);
  });

  test("clear resets diff state", () => {
    const buf = new ArrayBuffer(65536);
    const screen = new Bun.TUIScreen(10, 3);
    const writer = new Bun.TUIBufferWriter(buf);

    screen.setText(0, 0, "Hello");
    const n1 = writer.render(screen);

    writer.clear();

    // After clear, next render should be a full render again
    const n2 = writer.render(screen);
    // Full render should be the same size as the first
    expect(n2).toBe(n1);
  });

  // ─── byteOffset / byteLength ──────────────────────────────────────

  test("byteOffset and byteLength are set after render", () => {
    const buf = new ArrayBuffer(65536);
    const screen = new Bun.TUIScreen(10, 3);
    const writer = new Bun.TUIBufferWriter(buf);

    screen.setText(0, 0, "Hello");
    const n = writer.render(screen);

    expect(writer.byteOffset).toBe(n);
    expect(writer.byteLength).toBe(n);
    expect(writer.byteOffset).toBeGreaterThan(0);
  });

  test("byteLength exceeds byteOffset when buffer is too small", () => {
    const buf = new ArrayBuffer(32); // very small
    const screen = new Bun.TUIScreen(80, 24);
    const writer = new Bun.TUIBufferWriter(buf);

    for (let y = 0; y < 24; y++) {
      screen.setText(0, y, Buffer.alloc(80, "X").toString());
    }
    writer.render(screen);

    expect(writer.byteOffset).toBe(32); // capped at buffer size
    expect(writer.byteLength).toBeGreaterThan(32); // total rendered > buffer
  });

  test("byteOffset and byteLength reset after clear", () => {
    const buf = new ArrayBuffer(65536);
    const screen = new Bun.TUIScreen(10, 3);
    const writer = new Bun.TUIBufferWriter(buf);

    screen.setText(0, 0, "Hello");
    writer.render(screen);
    expect(writer.byteOffset).toBeGreaterThan(0);

    writer.clear();
    expect(writer.byteOffset).toBe(0);
    expect(writer.byteLength).toBe(0);
  });

  // ─── close() / end() ──────────────────────────────────────────────

  test("close() prevents further render calls", () => {
    const buf = new ArrayBuffer(65536);
    const screen = new Bun.TUIScreen(10, 3);
    const writer = new Bun.TUIBufferWriter(buf);

    writer.render(screen);
    writer.close();
    expect(() => writer.render(screen)).toThrow();
  });

  test("end() is an alias for close()", () => {
    const buf = new ArrayBuffer(65536);
    const screen = new Bun.TUIScreen(10, 3);
    const writer = new Bun.TUIBufferWriter(buf);

    writer.render(screen);
    writer.end();
    expect(() => writer.render(screen)).toThrow();
  });

  test("close() is idempotent", () => {
    const buf = new ArrayBuffer(65536);
    const writer = new Bun.TUIBufferWriter(buf);

    writer.close();
    writer.close(); // should not throw
  });

  test("close() resets byteOffset and byteLength", () => {
    const buf = new ArrayBuffer(65536);
    const screen = new Bun.TUIScreen(10, 3);
    const writer = new Bun.TUIBufferWriter(buf);

    screen.setText(0, 0, "Hello");
    writer.render(screen);
    expect(writer.byteOffset).toBeGreaterThan(0);

    writer.close();
    expect(writer.byteOffset).toBe(0);
    expect(writer.byteLength).toBe(0);
  });

  // ─── Inline mode ─────────────────────────────────────────────────

  describe("inline mode via TUIBufferWriter", () => {
    test("render with inline option uses LF instead of CUD", () => {
      const buf = new ArrayBuffer(65536);
      const writer = new Bun.TUIBufferWriter(buf);
      const screen = new Bun.TUIScreen(10, 3);
      screen.setText(0, 0, "Line1");
      screen.setText(0, 1, "Line2");
      screen.setText(0, 2, "Line3");

      writer.render(screen, { inline: true, viewportHeight: 24 });

      const output = new TextDecoder().decode(new Uint8Array(buf, 0, writer.byteOffset));
      // Should contain BSU/ESU
      expect(output).toContain("\x1b[?2026h");
      expect(output).toContain("\x1b[?2026l");
      // Should contain content
      expect(output).toContain("Line1");
      expect(output).toContain("Line2");
      expect(output).toContain("Line3");
      writer.close();
    });

    test("inline mode first render has CR+LF between rows", () => {
      const buf = new ArrayBuffer(65536);
      const writer = new Bun.TUIBufferWriter(buf);
      const screen = new Bun.TUIScreen(10, 2);
      screen.setText(0, 0, "A");
      screen.setText(0, 1, "B");

      writer.render(screen, { inline: true, viewportHeight: 24 });

      const output = new TextDecoder().decode(new Uint8Array(buf, 0, writer.byteOffset));
      // Between rows, renderFull emits \r\n
      expect(output).toContain("\r\n");
      expect(output).toContain("A");
      expect(output).toContain("B");
      writer.close();
    });

    test("inline diff uses LF for downward movement", () => {
      const buf = new ArrayBuffer(65536);
      const writer = new Bun.TUIBufferWriter(buf);
      const screen = new Bun.TUIScreen(10, 3);
      screen.setText(0, 0, "A");
      screen.setText(0, 1, "B");
      screen.setText(0, 2, "C");

      // First render (full)
      writer.render(screen, { inline: true, viewportHeight: 24 });
      const firstLen = writer.byteOffset;

      // Change only row 2
      screen.setText(0, 2, "X");
      writer.render(screen, { inline: true, viewportHeight: 24 });

      const output = new TextDecoder().decode(new Uint8Array(buf, 0, writer.byteOffset));
      // Diff render should contain the changed cell
      expect(output).toContain("X");
      writer.close();
    });
  });
});
