import { Terminal } from "@xterm/headless";
import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

/**
 * End-to-end tests: write to Screen → render via Writer → parse with xterm.js → verify.
 * Validates the full pipeline: Ghostty cell storage → ANSI diff output → terminal state.
 */

function renderToAnsi(cols: number, rows: number, setup: (screen: InstanceType<typeof Bun.TUIScreen>) => void): string {
  const screen = new Bun.TUIScreen(cols, rows);
  setup(screen);

  using dir = tempDir("tui-e2e", {});
  const path = join(String(dir), "output.bin");
  const fd = openSync(path, "w");
  const writer = new Bun.TUITerminalWriter(Bun.file(fd));
  writer.render(screen);
  closeSync(fd);

  return readFileSync(path, "utf8");
}

function feedXterm(ansi: string, cols: number, rows: number): Terminal {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  term.write(ansi);
  return term;
}

function xtermLine(term: Terminal, y: number): string {
  return term.buffer.active.getLine(y)?.translateToString(true) ?? "";
}

function xtermCell(term: Terminal, x: number, y: number) {
  const cell = term.buffer.active.getLine(y)?.getCell(x);
  if (!cell) return null;
  return {
    char: cell.getChars(),
    width: cell.getWidth(),
    fg: cell.getFgColor(),
    bg: cell.getBgColor(),
    isFgRGB: cell.isFgRGB(),
    isBgRGB: cell.isBgRGB(),
    bold: cell.isBold(),
    italic: cell.isItalic(),
    underline: cell.isUnderline(),
    strikethrough: cell.isStrikethrough(),
    inverse: cell.isInverse(),
    dim: cell.isDim(),
    overline: cell.isOverline(),
  };
}

/** Flush xterm.js write queue */
async function flush(term: Terminal): Promise<void> {
  await new Promise<void>(resolve => term.write("", resolve));
}

/**
 * Render a screen twice through the same writer, feed the combined output
 * to xterm.js. Returns the terminal after both renders are applied.
 */
async function renderTwoFrames(
  cols: number,
  rows: number,
  setup1: (screen: InstanceType<typeof Bun.TUIScreen>) => void,
  setup2: (screen: InstanceType<typeof Bun.TUIScreen>) => void,
): Promise<Terminal> {
  using dir = tempDir("tui-e2e-multi", {});
  const path = join(String(dir), "output.bin");
  const fd = openSync(path, "w");

  const screen = new Bun.TUIScreen(cols, rows);
  setup1(screen);

  const writer = new Bun.TUITerminalWriter(Bun.file(fd));
  writer.render(screen); // frame 1 (full)

  setup2(screen);
  writer.render(screen); // frame 2 (diff)

  closeSync(fd);
  const ansi = readFileSync(path, "utf8");
  const term = feedXterm(ansi, cols, rows);
  await flush(term);
  return term;
}

describe("TUI E2E: Screen → Writer → xterm.js", () => {
  // ─── Basic rendering ─────────────────────────────────────────────

  test("ASCII text renders correctly", async () => {
    const ansi = renderToAnsi(40, 5, screen => {
      screen.setText(0, 0, "Hello, World!");
      screen.setText(0, 1, "Line two");
    });

    const term = feedXterm(ansi, 40, 5);
    await flush(term);

    expect(xtermLine(term, 0).trimEnd()).toBe("Hello, World!");
    expect(xtermLine(term, 1).trimEnd()).toBe("Line two");
    expect(xtermLine(term, 2).trim()).toBe("");

    term.dispose();
  });

  test("CJK wide characters take 2 columns", async () => {
    const ansi = renderToAnsi(20, 3, screen => {
      screen.setText(0, 0, "A世界B");
    });

    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    expect(xtermCell(term, 0, 0)).toEqual(expect.objectContaining({ char: "A", width: 1 }));
    expect(xtermCell(term, 1, 0)).toEqual(expect.objectContaining({ char: "世", width: 2 }));
    expect(xtermCell(term, 2, 0)).toEqual(expect.objectContaining({ width: 0 }));
    expect(xtermCell(term, 3, 0)).toEqual(expect.objectContaining({ char: "界", width: 2 }));
    expect(xtermCell(term, 5, 0)).toEqual(expect.objectContaining({ char: "B" }));

    term.dispose();
  });

  // ─── Style rendering ─────────────────────────────────────────────

  test("bold style produces bold cells", async () => {
    const ansi = renderToAnsi(20, 3, screen => {
      const bold = screen.style({ bold: true });
      screen.setText(0, 0, "Bold", bold);
      screen.setText(5, 0, "Normal");
    });

    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    const boldCell = xtermCell(term, 0, 0)!;
    expect(boldCell.char).toBe("B");
    expect(boldCell.bold).toBeTruthy();

    const normalCell = xtermCell(term, 5, 0)!;
    expect(normalCell.char).toBe("N");
    expect(normalCell.bold).toBeFalsy();

    term.dispose();
  });

  test("italic style produces italic cells", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const italic = screen.style({ italic: true });
      screen.setText(0, 0, "Ital", italic);
      screen.setText(5, 0, "Norm");
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    expect(xtermCell(term, 0, 0)!.italic).toBeTruthy();
    expect(xtermCell(term, 5, 0)!.italic).toBeFalsy();

    term.dispose();
  });

  test("dim (faint) style", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const dim = screen.style({ faint: true });
      screen.setText(0, 0, "Dim", dim);
      screen.setText(5, 0, "Norm");
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    expect(xtermCell(term, 0, 0)!.dim).toBeTruthy();
    expect(xtermCell(term, 5, 0)!.dim).toBeFalsy();

    term.dispose();
  });

  test("strikethrough style", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const strike = screen.style({ strikethrough: true });
      screen.setText(0, 0, "Strike", strike);
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    expect(xtermCell(term, 0, 0)!.strikethrough).toBeTruthy();

    term.dispose();
  });

  test("inverse style", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const inv = screen.style({ inverse: true });
      screen.setText(0, 0, "Inv", inv);
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    expect(xtermCell(term, 0, 0)!.inverse).toBeTruthy();

    term.dispose();
  });

  test("overline style", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const over = screen.style({ overline: true });
      screen.setText(0, 0, "Over", over);
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    expect(xtermCell(term, 0, 0)!.overline).toBeTruthy();

    term.dispose();
  });

  test("underline style", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const ul = screen.style({ underline: "single" });
      screen.setText(0, 0, "UL", ul);
      screen.setText(5, 0, "Norm");
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    expect(xtermCell(term, 0, 0)!.underline).toBeTruthy();
    expect(xtermCell(term, 5, 0)!.underline).toBeFalsy();

    term.dispose();
  });

  test("combined bold+italic+strikethrough", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const s = screen.style({ bold: true, italic: true, strikethrough: true });
      screen.setText(0, 0, "Combo", s);
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    const cell = xtermCell(term, 0, 0)!;
    expect(cell.bold).toBeTruthy();
    expect(cell.italic).toBeTruthy();
    expect(cell.strikethrough).toBeTruthy();

    term.dispose();
  });

  test("RGB foreground color", async () => {
    const ansi = renderToAnsi(20, 3, screen => {
      const red = screen.style({ fg: 0xff0000 });
      screen.setText(0, 0, "Red", red);
    });

    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    expect(xtermCell(term, 0, 0)).toEqual(expect.objectContaining({ char: "R", isFgRGB: true, fg: 0xff0000 }));

    term.dispose();
  });

  test("RGB background color", async () => {
    const ansi = renderToAnsi(20, 3, screen => {
      const blue = screen.style({ bg: 0x0000ff });
      screen.setText(0, 0, "Blue", blue);
    });

    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    expect(xtermCell(term, 0, 0)).toEqual(expect.objectContaining({ char: "B", isBgRGB: true, bg: 0x0000ff }));

    term.dispose();
  });

  test("combined fg + bg colors", async () => {
    const ansi = renderToAnsi(20, 1, screen => {
      const s = screen.style({ fg: 0xff0000, bg: 0x00ff00 });
      screen.setText(0, 0, "Both", s);
    });

    const term = feedXterm(ansi, 20, 1);
    await flush(term);

    const cell = xtermCell(term, 0, 0)!;
    expect(cell.isFgRGB).toBeTruthy();
    expect(cell.fg).toBe(0xff0000);
    expect(cell.isBgRGB).toBeTruthy();
    expect(cell.bg).toBe(0x00ff00);

    term.dispose();
  });

  test("multiple styles on same line", async () => {
    const ansi = renderToAnsi(30, 3, screen => {
      const bold = screen.style({ bold: true });
      const italic = screen.style({ italic: true });
      screen.setText(0, 0, "Bold", bold);
      screen.setText(5, 0, "Italic", italic);
      screen.setText(12, 0, "Plain");
    });

    const term = feedXterm(ansi, 30, 3);
    await flush(term);

    const c0 = xtermCell(term, 0, 0)!;
    expect(c0.bold).toBeTruthy();
    expect(c0.italic).toBeFalsy();

    const c5 = xtermCell(term, 5, 0)!;
    expect(c5.italic).toBeTruthy();
    expect(c5.bold).toBeFalsy();

    const c12 = xtermCell(term, 12, 0)!;
    expect(c12.bold).toBeFalsy();
    expect(c12.italic).toBeFalsy();

    term.dispose();
  });

  test("style reset between rows", async () => {
    const ansi = renderToAnsi(20, 3, screen => {
      const bold = screen.style({ bold: true });
      screen.setText(0, 0, "BoldRow", bold);
      screen.setText(0, 1, "PlainRow");
    });

    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    expect(xtermCell(term, 0, 0)!.bold).toBeTruthy();
    expect(xtermCell(term, 0, 1)!.bold).toBeFalsy();

    term.dispose();
  });

  // ─── Fill / Clear ─────────────────────────────────────────────────

  test("fill fills region visible to xterm", async () => {
    const ansi = renderToAnsi(10, 3, screen => {
      screen.fill(0, 0, 10, 3, "#");
    });

    const term = feedXterm(ansi, 10, 3);
    await flush(term);

    expect(xtermLine(term, 0)).toBe("##########");
    expect(xtermLine(term, 1)).toBe("##########");
    expect(xtermLine(term, 2)).toBe("##########");

    term.dispose();
  });

  test("clearRect clears cells visible to xterm", async () => {
    const ansi = renderToAnsi(20, 3, screen => {
      screen.fill(0, 0, 20, 3, "X");
      screen.clearRect(5, 0, 10, 1);
    });

    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    const line0 = xtermLine(term, 0);
    expect(line0.substring(0, 5)).toBe("XXXXX");
    expect(line0.substring(15, 20)).toBe("XXXXX");
    expect(xtermLine(term, 1)).toBe(Buffer.alloc(20, "X").toString());

    term.dispose();
  });

  test("background color fills visible in xterm", async () => {
    const ansi = renderToAnsi(10, 1, screen => {
      const bg = screen.style({ bg: 0x0000ff });
      screen.fill(0, 0, 5, 1, " ", bg);
      screen.setText(5, 0, "X");
    });

    const term = feedXterm(ansi, 10, 1);
    await flush(term);

    // First 5 cells should have blue background
    const bgCell = xtermCell(term, 0, 0)!;
    expect(bgCell.isBgRGB).toBeTruthy();
    expect(bgCell.bg).toBe(0x0000ff);

    // Cell at 5 should have X
    expect(xtermCell(term, 5, 0)!.char).toBe("X");

    term.dispose();
  });

  // ─── Synchronized update ──────────────────────────────────────────

  test("synchronized update markers are present", () => {
    const ansi = renderToAnsi(10, 3, screen => {
      screen.setText(0, 0, "Hi");
    });

    expect(ansi).toContain("\x1b[?2026h");
    expect(ansi).toContain("\x1b[?2026l");

    const bsuIdx = ansi.indexOf("\x1b[?2026h");
    const esuIdx = ansi.indexOf("\x1b[?2026l");
    const contentIdx = ansi.indexOf("Hi");
    expect(bsuIdx).toBeLessThan(contentIdx);
    expect(esuIdx).toBeGreaterThan(contentIdx);
  });

  // ─── Multi-frame / Diff rendering ────────────────────────────────

  test("overwrite produces correct result after diff", async () => {
    const term = await renderTwoFrames(
      20,
      3,
      screen => {
        screen.setText(0, 0, "Hello");
      },
      screen => {
        screen.setText(0, 0, "AB"); // overwrite first 2 chars
      },
    );

    expect(xtermLine(term, 0).trimEnd()).toBe("ABllo");

    term.dispose();
  });

  test("clear then write across frames", async () => {
    const term = await renderTwoFrames(
      10,
      3,
      screen => {
        screen.fill(0, 0, 10, 3, "X");
      },
      screen => {
        screen.clearRect(0, 0, 10, 1); // clear row 0
        screen.setText(0, 0, "Y"); // write Y on row 0
      },
    );

    // Row 0 should start with Y, rest cleared
    const line0 = xtermLine(term, 0);
    expect(line0.charAt(0)).toBe("Y");
    // Row 1 should still be X's
    expect(xtermLine(term, 1)).toBe(Buffer.alloc(10, "X").toString());

    term.dispose();
  });

  test("multiple renders accumulate correctly", async () => {
    using dir = tempDir("tui-e2e-multi3", {});
    const path = join(String(dir), "output.bin");
    const fd = openSync(path, "w");

    const screen = new Bun.TUIScreen(20, 3);
    const writer = new Bun.TUITerminalWriter(Bun.file(fd));

    // Frame 1: write "AAAA" at positions 0-3
    screen.setText(0, 0, "AAAA");
    writer.render(screen);

    // Frame 2: overwrite first 2 with "BB" → cells: B B A A
    screen.setText(0, 0, "BB");
    writer.render(screen);

    // Frame 3: write "C" at position 4 → cells: B B A A C
    screen.setText(4, 0, "C");
    writer.render(screen);

    closeSync(fd);

    const ansi = readFileSync(path, "utf8");
    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    expect(xtermLine(term, 0).trimEnd()).toBe("BBAAC");

    term.dispose();
  });

  test("style changes across renders", async () => {
    const term = await renderTwoFrames(
      20,
      1,
      screen => {
        const bold = screen.style({ bold: true });
        screen.setText(0, 0, "Text", bold);
      },
      screen => {
        // Overwrite with plain text (no bold)
        screen.setText(0, 0, "Text");
      },
    );

    // After second frame, text should NOT be bold
    expect(xtermCell(term, 0, 0)!.bold).toBeFalsy();
    expect(xtermCell(term, 0, 0)!.char).toBe("T");

    term.dispose();
  });

  test("adding bold in second frame", async () => {
    const term = await renderTwoFrames(
      20,
      1,
      screen => {
        screen.setText(0, 0, "Plain");
      },
      screen => {
        const bold = screen.style({ bold: true });
        screen.setText(0, 0, "Plain", bold);
      },
    );

    expect(xtermCell(term, 0, 0)!.bold).toBeTruthy();

    term.dispose();
  });

  // ─── Large screen ─────────────────────────────────────────────────

  test("large screen render (200x50)", async () => {
    const cols = 200;
    const rows = 50;
    const ansi = renderToAnsi(cols, rows, screen => {
      // Fill with a pattern
      for (let y = 0; y < rows; y++) {
        const ch = String.fromCharCode(65 + (y % 26)); // A-Z
        screen.setText(0, y, Buffer.alloc(cols, ch).toString());
      }
    });

    const term = feedXterm(ansi, cols, rows);
    await flush(term);

    // Verify a few rows
    expect(xtermLine(term, 0)).toBe(Buffer.alloc(cols, "A").toString());
    expect(xtermLine(term, 1)).toBe(Buffer.alloc(cols, "B").toString());
    expect(xtermLine(term, 25)).toBe(Buffer.alloc(cols, "Z").toString());
    expect(xtermLine(term, 26)).toBe(Buffer.alloc(cols, "A").toString());
    expect(xtermLine(term, 49)).toBe(Buffer.alloc(cols, "X").toString());

    term.dispose();
  });

  // ─── Mixed content ───────────────────────────────────────────────

  test("mixed ASCII and CJK across rows", async () => {
    const ansi = renderToAnsi(20, 3, screen => {
      screen.setText(0, 0, "Hello");
      screen.setText(0, 1, "世界ABC");
      screen.setText(0, 2, "A世B界C");
    });

    const term = feedXterm(ansi, 20, 3);
    await flush(term);

    expect(xtermLine(term, 0).trimEnd()).toBe("Hello");
    // Row 1: 世(2) 界(2) A B C = 7 cols
    expect(xtermCell(term, 0, 1)!.char).toBe("世");
    expect(xtermCell(term, 2, 1)!.char).toBe("界");
    expect(xtermCell(term, 4, 1)!.char).toBe("A");

    // Row 2: A(1) 世(2) B(1) 界(2) C(1) = 7 cols
    expect(xtermCell(term, 0, 2)!.char).toBe("A");
    expect(xtermCell(term, 1, 2)!.char).toBe("世");
    expect(xtermCell(term, 3, 2)!.char).toBe("B");
    expect(xtermCell(term, 4, 2)!.char).toBe("界");
    expect(xtermCell(term, 6, 2)!.char).toBe("C");

    term.dispose();
  });

  test("styled fill then overwrite with different style", async () => {
    const ansi = renderToAnsi(10, 1, screen => {
      const red = screen.style({ fg: 0xff0000 });
      screen.fill(0, 0, 10, 1, "X", red);

      const blue = screen.style({ fg: 0x0000ff });
      screen.setText(3, 0, "HI", blue);
    });

    const term = feedXterm(ansi, 10, 1);
    await flush(term);

    // Cells 0-2 should be red X
    expect(xtermCell(term, 0, 0)).toEqual(expect.objectContaining({ char: "X", fg: 0xff0000, isFgRGB: true }));
    // Cells 3-4 should be blue HI
    expect(xtermCell(term, 3, 0)).toEqual(expect.objectContaining({ char: "H", fg: 0x0000ff, isFgRGB: true }));
    expect(xtermCell(term, 4, 0)).toEqual(expect.objectContaining({ char: "I", fg: 0x0000ff, isFgRGB: true }));
    // Cells 5-9 should be red X again
    expect(xtermCell(term, 5, 0)).toEqual(expect.objectContaining({ char: "X", fg: 0xff0000, isFgRGB: true }));

    term.dispose();
  });
});
