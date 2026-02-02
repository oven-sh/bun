import { describe, expect, test } from "bun:test";
import { closeSync, openSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

/**
 * Performance benchmarks for TUI Screen/Writer.
 * These tests establish baselines for performance regression detection.
 * They verify that operations complete within reasonable time bounds.
 */

describe("TUI Performance", () => {
  test("setText ASCII throughput: 80x24 fills in < 50ms", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const row = Buffer.alloc(80, "A").toString();
    const iterations = 100;

    const start = Bun.nanoseconds();
    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y < 24; y++) {
        screen.setText(0, y, row);
      }
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6; // ms

    // 100 iterations of 24 rows × 80 chars = 192,000 setText calls worth of chars
    // Should complete in well under 50ms
    expect(elapsed).toBeLessThan(50);
  });

  test("setText CJK throughput: 80x24 fills in < 100ms", () => {
    const screen = new Bun.TUIScreen(80, 24);
    // 40 CJK chars = 80 columns
    const row = Buffer.alloc(40 * 3, 0)
      .fill("\xe4\xb8\x96") // 世 in UTF-8
      .toString("utf8");
    const iterations = 100;

    const start = Bun.nanoseconds();
    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y < 24; y++) {
        screen.setText(0, y, row);
      }
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    // CJK is slower due to width computation, but should still be fast
    expect(elapsed).toBeLessThan(100);
  });

  test("style interning: 1000 calls for same style < 50ms", () => {
    const screen = new Bun.TUIScreen(80, 24);
    const iterations = 1000;

    const start = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) {
      screen.style({ bold: true, fg: 0xff0000 });
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    // Relaxed for debug builds — release builds should be < 5ms
    expect(elapsed).toBeLessThan(50);
  });

  test("style interning: 200 unique styles < 10ms", () => {
    const screen = new Bun.TUIScreen(80, 24);

    const start = Bun.nanoseconds();
    for (let i = 0; i < 200; i++) {
      screen.style({ fg: i + 1 });
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    expect(elapsed).toBeLessThan(10);
  });

  test("full render 80x24 ASCII < 10ms", () => {
    using dir = tempDir("tui-bench-full", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(80, 24);
      const row = Buffer.alloc(80, "X").toString();
      for (let y = 0; y < 24; y++) {
        screen.setText(0, y, row);
      }
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));

      const start = Bun.nanoseconds();
      writer.render(screen);
      const elapsed = (Bun.nanoseconds() - start) / 1e6;

      expect(elapsed).toBeLessThan(10);
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("full render 200x50 ASCII < 20ms", () => {
    using dir = tempDir("tui-bench-full-large", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(200, 50);
      const row = Buffer.alloc(200, "X").toString();
      for (let y = 0; y < 50; y++) {
        screen.setText(0, y, row);
      }
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));

      const start = Bun.nanoseconds();
      writer.render(screen);
      const elapsed = (Bun.nanoseconds() - start) / 1e6;

      expect(elapsed).toBeLessThan(20);
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("diff render with 0 dirty rows < 1ms", () => {
    using dir = tempDir("tui-bench-noop", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(200, 50);
      const row = Buffer.alloc(200, "X").toString();
      for (let y = 0; y < 50; y++) {
        screen.setText(0, y, row);
      }
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen); // first render (full)

      // No changes — second render should be a no-op diff
      const start = Bun.nanoseconds();
      writer.render(screen);
      const elapsed = (Bun.nanoseconds() - start) / 1e6;

      expect(elapsed).toBeLessThan(1);
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("diff render with 3 dirty rows on 200x50 < 5ms", () => {
    using dir = tempDir("tui-bench-diff", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(200, 50);
      const row = Buffer.alloc(200, "X").toString();
      for (let y = 0; y < 50; y++) {
        screen.setText(0, y, row);
      }
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));
      writer.render(screen); // first render (full)

      // Change 3 rows
      screen.setText(0, 10, Buffer.alloc(200, "A").toString());
      screen.setText(0, 25, Buffer.alloc(200, "B").toString());
      screen.setText(0, 40, Buffer.alloc(200, "C").toString());

      const start = Bun.nanoseconds();
      writer.render(screen);
      const elapsed = (Bun.nanoseconds() - start) / 1e6;

      expect(elapsed).toBeLessThan(5);
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });

  test("clearRect performance: 1000 clears < 10ms", () => {
    const screen = new Bun.TUIScreen(80, 24);
    screen.fill(0, 0, 80, 24, "X");

    const start = Bun.nanoseconds();
    for (let i = 0; i < 1000; i++) {
      screen.clearRect(0, 0, 40, 12);
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    expect(elapsed).toBeLessThan(10);
  });

  test("fill performance: 1000 fills < 50ms", () => {
    const screen = new Bun.TUIScreen(80, 24);

    const start = Bun.nanoseconds();
    for (let i = 0; i < 1000; i++) {
      screen.fill(0, 0, 80, 24, "#");
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    // Relaxed for debug builds — release builds should be < 10ms
    expect(elapsed).toBeLessThan(50);
  });

  test("copy performance: 1000 copies < 20ms", () => {
    const src = new Bun.TUIScreen(80, 24);
    const dst = new Bun.TUIScreen(80, 24);
    src.fill(0, 0, 80, 24, "X");

    const start = Bun.nanoseconds();
    for (let i = 0; i < 1000; i++) {
      dst.copy(src, 0, 0, 0, 0, 80, 24);
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    expect(elapsed).toBeLessThan(20);
  });

  test("resize cycle: 100 resizes < 50ms", () => {
    const screen = new Bun.TUIScreen(80, 24);
    screen.fill(0, 0, 80, 24, "X");

    const start = Bun.nanoseconds();
    for (let i = 0; i < 100; i++) {
      screen.resize(160, 48);
      screen.resize(80, 24);
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    expect(elapsed).toBeLessThan(50);
  });

  test("getCell performance: 10000 reads < 200ms", () => {
    const screen = new Bun.TUIScreen(80, 24);
    screen.fill(0, 0, 80, 24, "X");

    const start = Bun.nanoseconds();
    for (let i = 0; i < 10000; i++) {
      screen.getCell(i % 80, i % 24);
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6;

    // Relaxed for debug builds — getCell allocates a JS object per call
    expect(elapsed).toBeLessThan(200);
  });

  test("multiple render frames: 100 renders < 100ms", () => {
    using dir = tempDir("tui-bench-multiframe", {});
    const filePath = join(String(dir), "output.bin");
    const fd = openSync(filePath, "w");
    try {
      const screen = new Bun.TUIScreen(80, 24);
      const writer = new Bun.TUITerminalWriter(Bun.file(fd));

      // First render
      screen.fill(0, 0, 80, 24, " ");
      writer.render(screen);

      const start = Bun.nanoseconds();
      for (let i = 0; i < 100; i++) {
        // Change 1-2 rows per frame (typical Claude Code usage)
        screen.setText(0, i % 24, `Frame ${i} content here`);
        writer.render(screen);
      }
      const elapsed = (Bun.nanoseconds() - start) / 1e6;

      expect(elapsed).toBeLessThan(100);
      closeSync(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {}
      throw e;
    }
  });
});
