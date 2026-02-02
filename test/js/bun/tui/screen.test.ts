import { describe, expect, test } from "bun:test";

describe("Bun.TUIScreen", () => {
  // ─── Constructor ──────────────────────────────────────────────────

  test("constructor creates a screen with given dimensions", () => {
    const screen = new Bun.TUIScreen(80, 24);
    expect(screen.width).toBe(80);
    expect(screen.height).toBe(24);
  });

  test("constructor throws with invalid arguments", () => {
    expect(() => new (Bun.TUIScreen as any)()).toThrow();
    expect(() => new (Bun.TUIScreen as any)(80)).toThrow();
    expect(() => new (Bun.TUIScreen as any)("a", "b")).toThrow();
  });

  test("constructor clamps dimensions to [1, 4096]", () => {
    const small = new Bun.TUIScreen(0, 0);
    expect(small.width).toBe(1);
    expect(small.height).toBe(1);

    const neg = new Bun.TUIScreen(-5, -10);
    expect(neg.width).toBe(1);
    expect(neg.height).toBe(1);

    const big = new Bun.TUIScreen(9999, 9999);
    expect(big.width).toBe(4096);
    expect(big.height).toBe(4096);
  });

  test("constructor creates 1x1 screen", () => {
    const screen = new Bun.TUIScreen(1, 1);
    expect(screen.width).toBe(1);
    expect(screen.height).toBe(1);
    const cell = screen.getCell(0, 0);
    expect(cell).not.toBeNull();
    expect(cell.char).toBe(" ");
  });

  // ─── setText: ASCII ───────────────────────────────────────────────

  test("setText writes ASCII text", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const cols = screen.setText(0, 0, "Hello");
    expect(cols).toBe(5);

    expect(screen.getCell(0, 0).char).toBe("H");
    expect(screen.getCell(4, 0).char).toBe("o");
  });

  test("setText with empty string returns 0", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const cols = screen.setText(0, 0, "");
    expect(cols).toBe(0);
  });

  test("setText clips at screen boundary", () => {
    const screen = new Bun.TUIScreen(5, 1);
    const cols = screen.setText(0, 0, "Hello World!");
    expect(cols).toBe(5);
    expect(screen.getCell(0, 0).char).toBe("H");
    expect(screen.getCell(4, 0).char).toBe("o");
  });

  test("setText at last column writes exactly one char", () => {
    const screen = new Bun.TUIScreen(10, 1);
    const cols = screen.setText(9, 0, "ABCDEF");
    expect(cols).toBe(1);
    expect(screen.getCell(9, 0).char).toBe("A");
  });

  test("setText at last row", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 4, "Bottom");
    expect(screen.getCell(0, 4).char).toBe("B");
    expect(screen.getCell(5, 4).char).toBe("m");
  });

  test("setText overwrites existing content", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.setText(0, 0, "AAAA");
    screen.setText(0, 0, "BB");
    expect(screen.getCell(0, 0).char).toBe("B");
    expect(screen.getCell(1, 0).char).toBe("B");
    expect(screen.getCell(2, 0).char).toBe("A");
    expect(screen.getCell(3, 0).char).toBe("A");
  });

  test("setText very long string clips correctly", () => {
    const screen = new Bun.TUIScreen(80, 1);
    const longStr = Buffer.alloc(10000, "X").toString();
    const cols = screen.setText(0, 0, longStr);
    expect(cols).toBe(80);
    expect(screen.getCell(79, 0).char).toBe("X");
  });

  test("setText with style ID", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const styleId = screen.style({ fg: 0xff0000, bold: true });
    expect(styleId).toBeGreaterThan(0);

    screen.setText(0, 0, "Red", styleId);
    expect(screen.getCell(0, 0).styleId).toBe(styleId);
  });

  // ─── setText: CJK wide characters ─────────────────────────────────

  test("setText handles CJK wide characters", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const cols = screen.setText(0, 0, "世界");
    expect(cols).toBe(4);

    expect(screen.getCell(0, 0)).toEqual(expect.objectContaining({ char: "世", wide: 1 }));
    expect(screen.getCell(1, 0).wide).toBe(2); // spacer_tail
    expect(screen.getCell(2, 0)).toEqual(expect.objectContaining({ char: "界", wide: 1 }));
    expect(screen.getCell(3, 0).wide).toBe(2);
  });

  test("wide char at last column doesn't fit", () => {
    const screen = new Bun.TUIScreen(5, 1);
    screen.setText(0, 0, "ABCDE"); // fill all 5 cells
    const cols = screen.setText(4, 0, "世"); // col 4, needs 2 cols, only 1 available
    expect(cols).toBe(0); // shouldn't fit
    expect(screen.getCell(4, 0).char).toBe("E"); // original preserved
  });

  test("wide char at col width-2 fits exactly", () => {
    const screen = new Bun.TUIScreen(5, 1);
    const cols = screen.setText(3, 0, "世");
    expect(cols).toBe(2);
    expect(screen.getCell(3, 0)).toEqual(expect.objectContaining({ char: "世", wide: 1 }));
    expect(screen.getCell(4, 0).wide).toBe(2);
  });

  test("overwrite wide char partially clears spacer", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.setText(5, 0, "世"); // occupies 5,6
    expect(screen.getCell(5, 0).wide).toBe(1); // wide
    expect(screen.getCell(6, 0).wide).toBe(2); // spacer_tail

    // Overwrite just col 5 with a narrow char
    screen.setText(5, 0, "A");
    expect(screen.getCell(5, 0).char).toBe("A");
    expect(screen.getCell(5, 0).wide).toBe(0); // narrow
    // The spacer at col 6 is stale — it's up to the renderer to handle
  });

  // ─── setText: Unicode edge cases ──────────────────────────────────

  test("setText handles real emoji (non-BMP)", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const cols = screen.setText(0, 0, "😀");
    expect(cols).toBe(2); // emoji is width 2
    expect(screen.getCell(0, 0).char).toBe("😀");
    expect(screen.getCell(0, 0).wide).toBe(1);
    expect(screen.getCell(1, 0).wide).toBe(2); // spacer
  });

  test("setText handles combining marks (e + combining acute)", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // e (U+0065) + combining acute accent (U+0301) = é
    const cols = screen.setText(0, 0, "e\u0301");
    // Should be 1 column — combining mark attaches to 'e'
    expect(cols).toBe(1);
    // The base character should be 'e'
    expect(screen.getCell(0, 0).char).toBe("e");
  });

  test("setText handles ZWJ emoji sequences (family)", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // 👨‍👩‍👧 = man + ZWJ + woman + ZWJ + girl
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const cols = screen.setText(0, 0, family);
    // With ZWJ grapheme clustering: 👨 takes 2 cols, ZWJ + subsequent
    // emoji codepoints are appended as grapheme extensions → 2 cols total.
    expect(cols).toBe(2);
    // The base character cell should contain 👨
    expect(screen.getCell(0, 0).char).toBe("\u{1F468}");
    expect(screen.getCell(0, 0).wide).toBe(1); // wide
    expect(screen.getCell(1, 0).wide).toBe(2); // spacer_tail
  });

  test("setText handles regional indicators (flag)", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // 🇺🇸 = U+1F1FA U+1F1F8
    const flag = "\u{1F1FA}\u{1F1F8}";
    const cols = screen.setText(0, 0, flag);
    // Regional indicators: first is width 1, second may be zero-width
    // The exact behavior depends on visibleCodepointWidth for each RI
    expect(cols).toBeGreaterThanOrEqual(1);
  });

  test("setText handles variation selectors", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // ☺ (U+263A) + VS16 (U+FE0F) = emoji presentation
    const cols = screen.setText(0, 0, "\u263A\uFE0F");
    // VS16 is zero-width, should attach to preceding char
    expect(cols).toBeGreaterThanOrEqual(1);
  });

  test("setText handles null codepoint in middle", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // Should not crash
    const cols = screen.setText(0, 0, "A\0B");
    expect(cols).toBeGreaterThanOrEqual(2);
  });

  test("setText handles mixed ASCII and CJK", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // This tests the fast-path to slow-path transition
    const cols = screen.setText(0, 0, "Hello世界World");
    // Hello=5, 世=2, 界=2, World=5 → 14
    expect(cols).toBe(14);
    expect(screen.getCell(0, 0).char).toBe("H");
    expect(screen.getCell(5, 0).char).toBe("世");
    expect(screen.getCell(9, 0).char).toBe("W");
  });

  test("setText handles Devanagari conjuncts", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // क (ka) + ् (virama) + ष (ssa) = क्ष
    const cols = screen.setText(0, 0, "\u0915\u094D\u0937");
    expect(cols).toBeGreaterThanOrEqual(1); // at least 1 visible cell
  });

  // ─── setText: error handling ──────────────────────────────────────

  test("setText throws with too few arguments", () => {
    const screen = new Bun.TUIScreen(80, 24);
    expect(() => (screen as any).setText(0, 0)).toThrow();
    expect(() => (screen as any).setText(0)).toThrow();
    expect(() => (screen as any).setText()).toThrow();
  });

  test("setText throws with non-string text", () => {
    const screen = new Bun.TUIScreen(80, 24);
    expect(() => (screen as any).setText(0, 0, 42)).toThrow();
  });

  // ─── style ────────────────────────────────────────────────────────

  test("style interns identical styles", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const id1 = screen.style({ fg: 0xff0000, bold: true });
    const id2 = screen.style({ fg: 0xff0000, bold: true });
    expect(id1).toBe(id2);
  });

  test("style interns same style 1000 times — same ID", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const first = screen.style({ bold: true, fg: 0x112233 });
    for (let i = 0; i < 1000; i++) {
      expect(screen.style({ bold: true, fg: 0x112233 })).toBe(first);
    }
  });

  test("style supports all individual flags", () => {
    const screen = new Bun.TUIScreen(80, 24);

    const bold = screen.style({ bold: true });
    const italic = screen.style({ italic: true });
    const faint = screen.style({ faint: true });
    const blink = screen.style({ blink: true });
    const inverse = screen.style({ inverse: true });
    const invisible = screen.style({ invisible: true });
    const strikethrough = screen.style({ strikethrough: true });
    const overline = screen.style({ overline: true });

    // All should be unique non-zero IDs
    const ids = [bold, italic, faint, blink, inverse, invisible, strikethrough, overline];
    for (const id of ids) expect(id).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("style with all attributes combined", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const id = screen.style({
      bold: true,
      italic: true,
      faint: true,
      blink: true,
      inverse: true,
      invisible: true,
      strikethrough: true,
      overline: true,
      underline: "curly",
      fg: 0xff0000,
      bg: 0x00ff00,
      underlineColor: 0x0000ff,
    });
    expect(id).toBeGreaterThan(0);
  });

  test("style supports all underline variants", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const single = screen.style({ underline: "single" });
    const double = screen.style({ underline: "double" });
    const curly = screen.style({ underline: "curly" });
    const dotted = screen.style({ underline: "dotted" });
    const dashed = screen.style({ underline: "dashed" });

    const ids = [single, double, curly, dotted, dashed];
    for (const id of ids) expect(id).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(5);
  });

  test("underline: true maps to single", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const fromBool = screen.style({ underline: true });
    const fromStr = screen.style({ underline: "single" });
    expect(fromBool).toBe(fromStr);
  });

  test("style supports hex string colors", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const s1 = screen.style({ fg: "#ff0000" });
    const s2 = screen.style({ fg: 0xff0000 });
    // Both should produce the same RGB, so same style ID
    expect(s1).toBe(s2);
  });

  test("style supports underlineColor", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const id = screen.style({ underline: "curly", underlineColor: 0xff0000 });
    expect(id).toBeGreaterThan(0);
  });

  test("style with empty object returns 0 (default style)", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const id = screen.style({});
    expect(id).toBe(0);
  });

  test("style with non-boolean flags ignores them", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // Non-boolean values for boolean flags should be ignored (treated as no flag)
    const id = screen.style({ bold: "yes" as any });
    // Since bold: "yes" is not a boolean, it should be ignored → default style
    expect(id).toBe(0);
  });

  test("style with invalid hex color produces none color", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // 3-char hex is not supported (only 6-char)
    const id = screen.style({ fg: "#FFF" });
    // Invalid hex → .none color → default style
    expect(id).toBe(0);
  });

  test("style throws with non-object argument", () => {
    const screen = new Bun.TUIScreen(80, 24);
    expect(() => (screen as any).style()).toThrow();
    expect(() => (screen as any).style(42)).toThrow();
    expect(() => (screen as any).style("bold")).toThrow();
  });

  test("many unique styles up to capacity", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const ids = new Set<number>();
    // Create styles with unique colors — capacity is 256
    // We leave some headroom since style 0 is reserved
    for (let i = 1; i < 200; i++) {
      const id = screen.style({ fg: i });
      ids.add(id);
    }
    // Should all be unique
    expect(ids.size).toBe(199);
  });

  // ─── clearRect ────────────────────────────────────────────────────

  test("clearRect clears cells", () => {
    const screen = new Bun.TUIScreen(80, 24);
    screen.setText(0, 0, "Hello World");
    screen.clearRect(0, 0, 5, 1);
    expect(screen.getCell(0, 0).char).toBe(" ");
    // "Hello World": H(0) e(1) l(2) l(3) o(4) ' '(5) W(6) — cell 6 is 'W'
    expect(screen.getCell(6, 0).char).toBe("W");
  });

  test("clearRect with zero width is no-op", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hello");
    screen.clearRect(0, 0, 0, 5);
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("clearRect with zero height is no-op", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hello");
    screen.clearRect(0, 0, 10, 0);
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("clearRect exceeding bounds clips correctly", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.fill(0, 0, 10, 5, "X");
    // Clear from (7,3) with w=100, h=100 — should clip to actual bounds
    screen.clearRect(7, 3, 100, 100);
    // Cells before the rect should be untouched
    expect(screen.getCell(6, 3).char).toBe("X");
    expect(screen.getCell(0, 2).char).toBe("X");
    // Cells in the cleared area should be blank
    expect(screen.getCell(7, 3).char).toBe(" ");
    expect(screen.getCell(9, 4).char).toBe(" ");
  });

  test("clearRect throws with too few arguments", () => {
    const screen = new Bun.TUIScreen(10, 5);
    expect(() => (screen as any).clearRect(0, 0, 10)).toThrow();
    expect(() => (screen as any).clearRect(0, 0)).toThrow();
  });

  // ─── fill ─────────────────────────────────────────────────────────

  test("fill fills region with character", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.fill(0, 0, 10, 5, "#");
    expect(screen.getCell(0, 0).char).toBe("#");
    expect(screen.getCell(9, 4).char).toBe("#");
  });

  test("fill with style", () => {
    const screen = new Bun.TUIScreen(10, 5);
    const sid = screen.style({ bg: 0x0000ff });
    screen.fill(0, 0, 10, 5, " ", sid);
    expect(screen.getCell(5, 2).styleId).toBe(sid);
  });

  test("fill with numeric codepoint", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.fill(0, 0, 5, 1, 0x41); // 'A'
    expect(screen.getCell(0, 0).char).toBe("A");
    expect(screen.getCell(4, 0).char).toBe("A");
  });

  test("fill with empty string fills spaces", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.fill(0, 0, 10, 1, "X");
    screen.fill(0, 0, 5, 1, "");
    // Empty string → space fill
    expect(screen.getCell(0, 0).char).toBe(" ");
    expect(screen.getCell(5, 0).char).toBe("X");
  });

  test("fill with multi-char string uses first codepoint", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.fill(0, 0, 10, 1, "ABC");
    // Should fill with 'A' only
    expect(screen.getCell(0, 0).char).toBe("A");
    expect(screen.getCell(9, 0).char).toBe("A");
  });

  test("fill with wide character creates wide+spacer pairs", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.fill(0, 0, 10, 1, "世");
    // 10 cols / 2 per wide char = 5 wide chars
    for (let i = 0; i < 10; i += 2) {
      expect(screen.getCell(i, 0)).toEqual(expect.objectContaining({ char: "世", wide: 1 }));
      expect(screen.getCell(i + 1, 0).wide).toBe(2); // spacer_tail
    }
  });

  test("fill with wide char on odd-width region leaves last col empty", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.fill(0, 0, 10, 1, "X"); // pre-fill
    screen.fill(0, 0, 5, 1, "世"); // 5 cols, fits 2 wide chars (4 cols), last col untouched
    expect(screen.getCell(0, 0).char).toBe("世");
    expect(screen.getCell(2, 0).char).toBe("世");
    // Col 4 was not filled (would need 2 cols but only 1 left)
    expect(screen.getCell(4, 0).char).toBe("X");
  });

  test("fill with zero width is no-op", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hello");
    screen.fill(0, 0, 0, 5, "X");
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("fill with zero height is no-op", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hello");
    screen.fill(0, 0, 10, 0, "X");
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("fill throws with too few arguments", () => {
    const screen = new Bun.TUIScreen(10, 5);
    expect(() => (screen as any).fill(0, 0, 10, 5)).toThrow();
    expect(() => (screen as any).fill(0, 0)).toThrow();
  });

  // ─── copy ─────────────────────────────────────────────────────────

  test("copy blits from another screen", () => {
    const src = new Bun.TUIScreen(20, 10);
    const dst = new Bun.TUIScreen(20, 10);

    src.setText(0, 0, "Source");
    dst.copy(src, 0, 0, 5, 5, 6, 1);

    expect(dst.getCell(5, 5).char).toBe("S");
    expect(dst.getCell(10, 5).char).toBe("e");
  });

  test("copy with zero width is no-op", () => {
    const src = new Bun.TUIScreen(10, 5);
    const dst = new Bun.TUIScreen(10, 5);
    dst.setText(0, 0, "Hello");
    dst.copy(src, 0, 0, 0, 0, 0, 5);
    expect(dst.getCell(0, 0).char).toBe("H");
  });

  test("copy with zero height is no-op", () => {
    const src = new Bun.TUIScreen(10, 5);
    const dst = new Bun.TUIScreen(10, 5);
    dst.setText(0, 0, "Hello");
    dst.copy(src, 0, 0, 0, 0, 10, 0);
    expect(dst.getCell(0, 0).char).toBe("H");
  });

  test("copy clips when destination is too small", () => {
    const src = new Bun.TUIScreen(20, 10);
    const dst = new Bun.TUIScreen(10, 5);
    src.fill(0, 0, 20, 10, "X");
    // Copy 20-wide row into dst starting at col 5 — should clip to 5 cols
    dst.copy(src, 0, 0, 5, 0, 20, 1);
    expect(dst.getCell(5, 0).char).toBe("X");
    expect(dst.getCell(9, 0).char).toBe("X");
  });

  test("copy from self (non-overlapping) works", () => {
    const screen = new Bun.TUIScreen(20, 5);
    screen.setText(0, 0, "Hello");
    // Copy row 0 to row 2 — non-overlapping
    screen.copy(screen, 0, 0, 0, 2, 5, 1);
    expect(screen.getCell(0, 2).char).toBe("H");
    expect(screen.getCell(4, 2).char).toBe("o");
    // Original should be preserved
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("copy throws with non-Screen first argument", () => {
    const screen = new Bun.TUIScreen(10, 5);
    expect(() => (screen as any).copy({}, 0, 0, 0, 0, 10, 5)).toThrow();
    expect(() => (screen as any).copy(42, 0, 0, 0, 0, 10, 5)).toThrow();
  });

  test("copy throws with too few arguments", () => {
    const src = new Bun.TUIScreen(10, 5);
    const dst = new Bun.TUIScreen(10, 5);
    expect(() => (dst as any).copy(src, 0, 0, 0, 0, 10)).toThrow();
  });

  // ─── resize ───────────────────────────────────────────────────────

  test("resize preserves content", () => {
    const screen = new Bun.TUIScreen(80, 24);
    screen.setText(0, 0, "Hello");
    screen.resize(40, 12);
    expect(screen.width).toBe(40);
    expect(screen.height).toBe(12);
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("resize to larger adds empty space", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hi");
    screen.resize(20, 10);
    expect(screen.width).toBe(20);
    expect(screen.height).toBe(10);
    expect(screen.getCell(0, 0).char).toBe("H");
    expect(screen.getCell(15, 8).char).toBe(" ");
  });

  test("resize to same size is no-op", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hello");
    screen.resize(10, 5);
    expect(screen.width).toBe(10);
    expect(screen.height).toBe(5);
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("resize to 1x1 preserves top-left cell", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hello");
    screen.resize(1, 1);
    expect(screen.width).toBe(1);
    expect(screen.height).toBe(1);
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("resize larger then smaller round-trips content", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.setText(0, 0, "Hello");
    screen.resize(20, 10);
    screen.resize(10, 5);
    expect(screen.getCell(0, 0).char).toBe("H");
    expect(screen.getCell(4, 0).char).toBe("o");
  });

  test("rapid resize cycle doesn't crash", () => {
    const screen = new Bun.TUIScreen(80, 24);
    screen.setText(0, 0, "Test");
    for (let i = 0; i < 100; i++) {
      const w = ((i * 7 + 3) % 200) + 1;
      const h = ((i * 11 + 5) % 100) + 1;
      screen.resize(w, h);
    }
    // Should not crash, dimensions should be valid
    expect(screen.width).toBeGreaterThanOrEqual(1);
    expect(screen.height).toBeGreaterThanOrEqual(1);
  });

  test("resize clamps to [1, 4096]", () => {
    const screen = new Bun.TUIScreen(10, 5);
    screen.resize(0, 0);
    expect(screen.width).toBe(1);
    expect(screen.height).toBe(1);
  });

  test("resize throws with too few arguments", () => {
    const screen = new Bun.TUIScreen(10, 5);
    expect(() => (screen as any).resize(10)).toThrow();
    expect(() => (screen as any).resize()).toThrow();
  });

  // ─── clear ────────────────────────────────────────────────────────

  test("clear resets all cells", () => {
    const screen = new Bun.TUIScreen(80, 24);
    screen.setText(0, 0, "Hello");
    screen.clear();
    expect(screen.getCell(0, 0).char).toBe(" ");
    expect(screen.getCell(4, 0).char).toBe(" ");
  });

  // ─── getCell ──────────────────────────────────────────────────────

  test("getCell returns null for out-of-bounds", () => {
    const screen = new Bun.TUIScreen(80, 24);
    expect(screen.getCell(-1, 0)).toBeNull();
    expect(screen.getCell(80, 0)).toBeNull();
    expect(screen.getCell(0, 24)).toBeNull();
    expect(screen.getCell(0, -1)).toBeNull();
  });

  test("getCell returns null for large coordinates", () => {
    const screen = new Bun.TUIScreen(10, 5);
    expect(screen.getCell(999999, 0)).toBeNull();
    expect(screen.getCell(0, 999999)).toBeNull();
  });

  test("getCell on spacer_tail returns spacer wide flag", () => {
    const screen = new Bun.TUIScreen(10, 1);
    screen.setText(0, 0, "世");
    const spacer = screen.getCell(1, 0);
    expect(spacer.wide).toBe(2); // spacer_tail
  });

  test("getCell throws with too few arguments", () => {
    const screen = new Bun.TUIScreen(10, 5);
    expect(() => (screen as any).getCell(0)).toThrow();
    expect(() => (screen as any).getCell()).toThrow();
  });

  // ─── 1x1 screen stress ───────────────────────────────────────────

  test("1x1 screen: write single char", () => {
    const screen = new Bun.TUIScreen(1, 1);
    const cols = screen.setText(0, 0, "X");
    expect(cols).toBe(1);
    expect(screen.getCell(0, 0).char).toBe("X");
  });

  test("1x1 screen: wide char doesn't fit", () => {
    const screen = new Bun.TUIScreen(1, 1);
    const cols = screen.setText(0, 0, "世");
    expect(cols).toBe(0); // needs 2 cols, only 1 available
  });

  test("1x1 screen: fill", () => {
    const screen = new Bun.TUIScreen(1, 1);
    screen.fill(0, 0, 1, 1, "Z");
    expect(screen.getCell(0, 0).char).toBe("Z");
  });

  test("1x1 screen: clearRect", () => {
    const screen = new Bun.TUIScreen(1, 1);
    screen.setText(0, 0, "X");
    screen.clearRect(0, 0, 1, 1);
    expect(screen.getCell(0, 0).char).toBe(" ");
  });

  // ─── Clipping ───────────────────────────────────────────────────

  test("clip restricts setText writes", () => {
    const screen = new Bun.TUIScreen(20, 5);
    screen.clip(5, 1, 15, 4);
    // Write outside clip region — should be skipped
    screen.setText(0, 0, "Outside");
    expect(screen.getCell(0, 0).char).toBe(" ");
    // Write inside clip region
    screen.setText(5, 1, "Inside");
    expect(screen.getCell(5, 1).char).toBe("I");
    screen.unclip();
  });

  test("clip restricts fill", () => {
    const screen = new Bun.TUIScreen(20, 5);
    screen.clip(2, 1, 8, 3);
    screen.fill(0, 0, 20, 5, "X");
    // Inside clip: filled
    expect(screen.getCell(2, 1).char).toBe("X");
    expect(screen.getCell(7, 2).char).toBe("X");
    // Outside clip: untouched
    expect(screen.getCell(0, 0).char).toBe(" ");
    expect(screen.getCell(8, 1).char).toBe(" ");
    expect(screen.getCell(2, 0).char).toBe(" ");
    screen.unclip();
  });

  test("clip restricts clearRect", () => {
    const screen = new Bun.TUIScreen(20, 5);
    screen.fill(0, 0, 20, 5, "X");
    screen.clip(5, 1, 15, 4);
    screen.clearRect(0, 0, 20, 5);
    // Inside clip: cleared
    expect(screen.getCell(5, 1).char).toBe(" ");
    // Outside clip: still X
    expect(screen.getCell(0, 0).char).toBe("X");
    expect(screen.getCell(4, 1).char).toBe("X");
    screen.unclip();
  });

  test("unclip restores full access", () => {
    const screen = new Bun.TUIScreen(10, 3);
    screen.clip(3, 1, 7, 2);
    screen.unclip();
    screen.setText(0, 0, "Hello");
    expect(screen.getCell(0, 0).char).toBe("H");
  });

  test("clip stack allows nesting", () => {
    const screen = new Bun.TUIScreen(20, 5);
    screen.clip(0, 0, 20, 5);
    screen.clip(5, 1, 15, 4);
    screen.fill(0, 0, 20, 5, "X");
    // Only inner clip applies
    expect(screen.getCell(0, 0).char).toBe(" ");
    expect(screen.getCell(5, 1).char).toBe("X");
    screen.unclip();
    // Outer clip now applies
    screen.fill(0, 0, 20, 5, "Y");
    expect(screen.getCell(0, 0).char).toBe("Y");
    screen.unclip();
  });

  test("setText clips at right edge of clip rect", () => {
    const screen = new Bun.TUIScreen(20, 3);
    screen.clip(5, 0, 10, 3);
    // Start at col 5, clip end at col 10 — only 5 chars fit
    const cols = screen.setText(5, 0, "Hello World");
    expect(cols).toBe(5);
    expect(screen.getCell(5, 0).char).toBe("H");
    expect(screen.getCell(9, 0).char).toBe("o");
    screen.unclip();
  });

  // ─── Hyperlinks ─────────────────────────────────────────────────

  test("hyperlink interns URLs and returns IDs", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const id1 = screen.hyperlink("https://example.com");
    const id2 = screen.hyperlink("https://other.com");
    const id3 = screen.hyperlink("https://example.com");
    expect(id1).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(0);
    expect(id1).not.toBe(id2);
    expect(id3).toBe(id1); // same URL → same ID
  });

  test("setHyperlink sets and getCell works", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const id = screen.hyperlink("https://example.com");
    screen.setText(0, 0, "Click");
    screen.setHyperlink(0, 0, id);
    screen.setHyperlink(1, 0, id);
    // setHyperlink doesn't crash
    expect(screen.getCell(0, 0).char).toBe("C");
  });

  test("setHyperlink with out-of-bounds is no-op", () => {
    const screen = new Bun.TUIScreen(10, 5);
    const id = screen.hyperlink("https://example.com");
    // Should not crash
    screen.setHyperlink(100, 100, id);
    screen.setHyperlink(-1, -1, id);
  });

  test("hyperlink throws with non-string argument", () => {
    const screen = new Bun.TUIScreen(80, 24);
    expect(() => (screen as any).hyperlink()).toThrow();
    expect(() => (screen as any).hyperlink(42)).toThrow();
  });

  // ─── drawBox ──────────────────────────────────────────────────────

  describe("drawBox", () => {
    test("draws a box with default single border", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 5, 3);
      // Top-left corner
      expect(screen.getCell(0, 0).char).toBe("\u250C"); // ┌
      // Top-right corner
      expect(screen.getCell(4, 0).char).toBe("\u2510"); // ┐
      // Bottom-left corner
      expect(screen.getCell(0, 2).char).toBe("\u2514"); // └
      // Bottom-right corner
      expect(screen.getCell(4, 2).char).toBe("\u2518"); // ┘
      // Top horizontal border
      expect(screen.getCell(1, 0).char).toBe("\u2500"); // ─
      expect(screen.getCell(2, 0).char).toBe("\u2500"); // ─
      expect(screen.getCell(3, 0).char).toBe("\u2500"); // ─
      // Left vertical border
      expect(screen.getCell(0, 1).char).toBe("\u2502"); // │
      // Right vertical border
      expect(screen.getCell(4, 1).char).toBe("\u2502"); // │
    });

    test("draws a box with double border style", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 5, 3, { style: "double" });
      expect(screen.getCell(0, 0).char).toBe("\u2554"); // ╔
      expect(screen.getCell(4, 0).char).toBe("\u2557"); // ╗
      expect(screen.getCell(0, 2).char).toBe("\u255A"); // ╚
      expect(screen.getCell(4, 2).char).toBe("\u255D"); // ╝
      expect(screen.getCell(1, 0).char).toBe("\u2550"); // ═
      expect(screen.getCell(0, 1).char).toBe("\u2551"); // ║
    });

    test("draws a box with rounded border style", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 5, 3, { style: "rounded" });
      expect(screen.getCell(0, 0).char).toBe("\u256D"); // ╭
      expect(screen.getCell(4, 0).char).toBe("\u256E"); // ╮
      expect(screen.getCell(0, 2).char).toBe("\u2570"); // ╰
      expect(screen.getCell(4, 2).char).toBe("\u256F"); // ╯
      // Horizontal and vertical are same as single
      expect(screen.getCell(1, 0).char).toBe("\u2500"); // ─
      expect(screen.getCell(0, 1).char).toBe("\u2502"); // │
    });

    test("draws a box with heavy border style", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 5, 3, { style: "heavy" });
      expect(screen.getCell(0, 0).char).toBe("\u250F"); // ┏
      expect(screen.getCell(4, 0).char).toBe("\u2513"); // ┓
      expect(screen.getCell(0, 2).char).toBe("\u2517"); // ┗
      expect(screen.getCell(4, 2).char).toBe("\u251B"); // ┛
      expect(screen.getCell(1, 0).char).toBe("\u2501"); // ━
      expect(screen.getCell(0, 1).char).toBe("\u2503"); // ┃
    });

    test("draws a box with ascii border style", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 5, 3, { style: "ascii" });
      expect(screen.getCell(0, 0).char).toBe("+");
      expect(screen.getCell(4, 0).char).toBe("+");
      expect(screen.getCell(0, 2).char).toBe("+");
      expect(screen.getCell(4, 2).char).toBe("+");
      expect(screen.getCell(1, 0).char).toBe("-");
      expect(screen.getCell(0, 1).char).toBe("|");
    });

    test("box smaller than 2x2 is no-op", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.fill(0, 0, 10, 5, "X");
      // 1x1 box
      screen.drawBox(0, 0, 1, 1);
      expect(screen.getCell(0, 0).char).toBe("X");
      // 1x3 box
      screen.drawBox(0, 0, 1, 3);
      expect(screen.getCell(0, 0).char).toBe("X");
      // 3x1 box
      screen.drawBox(0, 0, 3, 1);
      expect(screen.getCell(0, 0).char).toBe("X");
      // 0x0 box
      screen.drawBox(0, 0, 0, 0);
      expect(screen.getCell(0, 0).char).toBe("X");
    });

    test("box with fill: true fills interior with spaces", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.fill(0, 0, 10, 5, "X");
      screen.drawBox(0, 0, 5, 4, { fill: true });
      // Border should be drawn
      expect(screen.getCell(0, 0).char).toBe("\u250C"); // ┌
      // Interior should be spaces
      expect(screen.getCell(1, 1).char).toBe(" ");
      expect(screen.getCell(2, 1).char).toBe(" ");
      expect(screen.getCell(3, 1).char).toBe(" ");
      expect(screen.getCell(1, 2).char).toBe(" ");
      expect(screen.getCell(2, 2).char).toBe(" ");
      expect(screen.getCell(3, 2).char).toBe(" ");
      // Outside box should be untouched
      expect(screen.getCell(5, 0).char).toBe("X");
      expect(screen.getCell(0, 4).char).toBe("X");
    });

    test("box with fill: true and custom fillChar", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 6, 4, { fill: true, fillChar: "." });
      // Interior filled with dots
      expect(screen.getCell(1, 1).char).toBe(".");
      expect(screen.getCell(4, 2).char).toBe(".");
      // Border should still be border chars
      expect(screen.getCell(0, 0).char).toBe("\u250C"); // ┌
    });

    test("box with styleId applies style to border", () => {
      const screen = new Bun.TUIScreen(10, 5);
      const sid = screen.style({ fg: 0xff0000, bold: true });
      screen.drawBox(0, 0, 5, 3, { styleId: sid });
      expect(screen.getCell(0, 0).styleId).toBe(sid);
      expect(screen.getCell(1, 0).styleId).toBe(sid);
      expect(screen.getCell(0, 1).styleId).toBe(sid);
    });

    test("minimum 2x2 box draws just corners", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 2, 2);
      expect(screen.getCell(0, 0).char).toBe("\u250C"); // ┌
      expect(screen.getCell(1, 0).char).toBe("\u2510"); // ┐
      expect(screen.getCell(0, 1).char).toBe("\u2514"); // └
      expect(screen.getCell(1, 1).char).toBe("\u2518"); // ┘
    });

    test("box at edge of screen clips dimensions", () => {
      const screen = new Bun.TUIScreen(10, 5);
      // Draw box at bottom-right that extends beyond screen
      // raw_w clamped to 10-7=3, raw_h clamped to 5-3=2 => 3x2 box
      screen.drawBox(7, 3, 10, 10);
      expect(screen.getCell(7, 3).char).toBe("\u250C"); // ┌ top-left
      expect(screen.getCell(9, 3).char).toBe("\u2510"); // ┐ top-right (col 9 = x+w-1)
      expect(screen.getCell(7, 4).char).toBe("\u2514"); // └ bottom-left
      expect(screen.getCell(9, 4).char).toBe("\u2518"); // ┘ bottom-right
      // Horizontal border between corners
      expect(screen.getCell(8, 3).char).toBe("\u2500"); // ─ top horizontal
    });

    test("box respects clip rect", () => {
      const screen = new Bun.TUIScreen(20, 10);
      screen.fill(0, 0, 20, 10, "X");
      // Set clip rect that contains the entire box
      screen.clip(1, 1, 12, 8);
      screen.drawBox(1, 1, 10, 6);
      // Inside clip: border chars drawn
      expect(screen.getCell(1, 1).char).toBe("\u250C"); // ┌ top-left corner
      expect(screen.getCell(10, 1).char).toBe("\u2510"); // ┐ top-right corner
      // Outside clip: untouched
      expect(screen.getCell(0, 0).char).toBe("X");
      expect(screen.getCell(11, 0).char).toBe("X");
      screen.unclip();
    });

    test("drawBox with unknown style name defaults to single", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.drawBox(0, 0, 5, 3, { style: "nonexistent" });
      expect(screen.getCell(0, 0).char).toBe("\u250C"); // ┌ (single)
    });

    test("drawBox throws with too few arguments", () => {
      const screen = new Bun.TUIScreen(10, 5);
      expect(() => (screen as any).drawBox(0, 0, 5)).toThrow();
      expect(() => (screen as any).drawBox(0, 0)).toThrow();
      expect(() => (screen as any).drawBox()).toThrow();
    });

    test("large box fills full screen", () => {
      const screen = new Bun.TUIScreen(80, 24);
      screen.drawBox(0, 0, 80, 24);
      // Corners
      expect(screen.getCell(0, 0).char).toBe("\u250C");
      expect(screen.getCell(79, 0).char).toBe("\u2510");
      expect(screen.getCell(0, 23).char).toBe("\u2514");
      expect(screen.getCell(79, 23).char).toBe("\u2518");
      // Middle of top border
      expect(screen.getCell(40, 0).char).toBe("\u2500");
      // Middle of left border
      expect(screen.getCell(0, 12).char).toBe("\u2502");
      // Interior should be empty (spaces)
      expect(screen.getCell(1, 1).char).toBe(" ");
    });

    test("drawBox interior not filled without fill option", () => {
      const screen = new Bun.TUIScreen(10, 5);
      screen.fill(0, 0, 10, 5, "X");
      screen.drawBox(0, 0, 5, 4);
      // Interior should retain original content (no fill)
      expect(screen.getCell(1, 1).char).toBe("X");
      expect(screen.getCell(2, 2).char).toBe("X");
    });

    test("drawBox with all options combined", () => {
      const screen = new Bun.TUIScreen(20, 10);
      const sid = screen.style({ fg: 0x00ff00 });
      screen.drawBox(2, 1, 10, 6, {
        style: "double",
        fill: true,
        fillChar: ".",
        styleId: sid,
      });
      // Corners with double border
      expect(screen.getCell(2, 1).char).toBe("\u2554"); // ╔
      expect(screen.getCell(11, 1).char).toBe("\u2557"); // ╗
      // Style applied
      expect(screen.getCell(2, 1).styleId).toBe(sid);
      // Interior filled with dots
      expect(screen.getCell(3, 2).char).toBe(".");
      expect(screen.getCell(10, 5).char).toBe(".");
    });
  });
});
