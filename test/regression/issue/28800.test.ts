// https://github.com/oven-sh/bun/issues/28800
//
// `bun --filter` pretty output used to cursor-up the previous frame's line
// count unconditionally. Once the frame grew taller than the terminal, the
// cursor-up escapes clamped at the viewport top and left stale lines on screen
// that looked like duplicated output. The fix caps per-handle content to fit
// the terminal window.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

describe.skipIf(isWindows)("issue 28800", () => {
  test("--filter frame stays within terminal rows when output is tall", async () => {
    using dir = tempDir("issue-28800", {
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        scripts: {
          build: "printf 'a-line-1\\na-line-2\\na-line-3\\na-line-4\\na-line-5\\na-line-6\\na-line-7\\na-line-8\\n'",
        },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        scripts: {
          build: "printf 'b-line-1\\nb-line-2\\nb-line-3\\nb-line-4\\nb-line-5\\nb-line-6\\nb-line-7\\nb-line-8\\n'",
        },
      }),
    });

    const terminalRows = 10;
    const chunks: Uint8Array[] = [];
    const proc = Bun.spawn([bunExe(), "--filter", "*", "build"], {
      cwd: String(dir),
      env: { ...bunEnv, TERM: "xterm-256color", FORCE_COLOR: "1" },
      terminal: {
        cols: 80,
        rows: terminalRows,
        data: (_terminal, data) => {
          chunks.push(data);
        },
      },
    });

    const exitCode = await proc.exited;
    proc.terminal!.close();

    const output = Buffer.concat(chunks).toString();

    // Each redraw emits a contiguous run of `\x1b[1A\x1b[K` escapes to clear
    // the previous frame. That run must never exceed the terminal height —
    // otherwise the cursor clamps at the top and stale lines remain visible.
    const upRuns = output.match(/(?:\x1b\[1A\x1b\[K)+/g) ?? [];
    const maxUp = upRuns.reduce((max, run) => {
      const count = run.length / "\x1b[1A\x1b[K".length;
      return count > max ? count : max;
    }, 0);
    expect(maxUp).toBeLessThanOrEqual(terminalRows);

    // Each rendered frame (between synchronized-update markers) should also
    // fit within the terminal. Synchronized updates are `\x1b[?2026h` (begin)
    // and `\x1b[?2026l` (end).
    const frameRegex = /\x1b\[\?2026h([\s\S]*?)\x1b\[\?2026l/g;
    const frames: string[] = [];
    for (const match of output.matchAll(frameRegex)) {
      frames.push(match[1]);
    }
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      // Strip all cursor-up/clear prefix sequences to count only new content.
      const newContent = frame.replace(/(?:\x1b\[[0-9;]*[A-Za-z])+/g, match => {
        return match.includes("\x1b[K") || match.includes("\x1b[1A") ? "" : match;
      });
      const newlines = (newContent.match(/\n/g) ?? []).length;
      expect(newlines).toBeLessThanOrEqual(terminalRows);
    }

    expect(exitCode).toBe(0);
  });
});
