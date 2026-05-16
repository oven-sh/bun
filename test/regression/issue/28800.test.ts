// https://github.com/oven-sh/bun/issues/28800
//
// `bun --filter` pretty output used to cursor-up the previous frame's line
// count unconditionally. Once the frame grew taller than the terminal, the
// cursor-up escapes clamped at the viewport top and left stale lines on
// screen that looked like duplicated output. The fix queries the terminal
// height at each redraw, caps per-handle content to fit, and clamps the
// cursor-up count at the terminal row count.
//
// Bun.Terminal (used to attach a PTY to the spawned bun) is POSIX-only; the
// Windows code path (`GetConsoleScreenBufferInfo`) is covered by the same
// capping logic in the shared redraw code tested here.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const UP_SEQ = "\x1b[1A\x1b[K";

function countRenderedLines(frame: string): number {
  // Strip cursor-movement / clear-line / colour escapes; count \n in what's
  // left to get the number of lines the frame would render.
  const stripped = frame
    .replace(/\x1b\[1A\x1b\[K/g, "") // cursor up + clear
    .replace(/\x1b\[0G\x1b\[K/g, "") // col 0 + clear
    .replace(/\x1b\[\?2026[hl]/g, "") // synchronized-update markers
    .replace(/\x1b\[[0-9;]*m/g, ""); // SGR colours
  return (stripped.match(/\n/g) ?? []).length;
}

async function runFilter(cwd: string, rows: number, cols = 80) {
  const chunks: Uint8Array[] = [];
  const proc = Bun.spawn([bunExe(), "--filter", "*", "build"], {
    cwd,
    env: { ...bunEnv, TERM: "xterm-256color", FORCE_COLOR: "1" },
    terminal: {
      cols,
      rows,
      data: (_terminal, data) => {
        chunks.push(data);
      },
    },
  });
  const exitCode = await proc.exited;
  proc.terminal!.close();
  return { output: Buffer.concat(chunks).toString(), exitCode };
}

function assertFramesFit(output: string, rows: number) {
  // Each redraw emits a contiguous run of `\x1b[1A\x1b[K` escapes to clear
  // the previous frame. That run must never exceed the terminal height —
  // otherwise the cursor clamps at the top and stale lines remain visible.
  const upRuns = output.match(/(?:\x1b\[1A\x1b\[K)+/g) ?? [];
  const maxUp = upRuns.reduce((max, run) => Math.max(max, run.length / UP_SEQ.length), 0);
  expect(maxUp).toBeLessThanOrEqual(rows);

  // Each rendered frame should also fit the terminal (so nothing scrolls off
  // past the cleared region).
  const frames = [...output.matchAll(/\x1b\[\?2026h([\s\S]*?)\x1b\[\?2026l/g)].map(m => m[1]);
  expect(frames.length).toBeGreaterThan(0);
  const maxFrameLines = frames.reduce((max, f) => Math.max(max, countRenderedLines(f)), 0);
  expect(maxFrameLines).toBeLessThanOrEqual(rows);
}

function script(prefix: string, count: number): string {
  let out = "";
  for (let i = 1; i <= count; i++) out += `${prefix}-${i}\\n`;
  return `printf '${out}'`;
}

describe.skipIf(isWindows)("issue 28800", () => {
  test("2 packages × 8 lines in a 10-row terminal", async () => {
    using dir = tempDir("issue-28800-2pkg", {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        scripts: { build: script("a", 8) },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        scripts: { build: script("b", 8) },
      }),
    });

    const { output, exitCode } = await runFilter(String(dir), 10);
    assertFramesFit(output, 10);
    expect(exitCode).toBe(0);
  });

  test("4 packages in a 10-row terminal (overhead exceeds rows)", async () => {
    // With 4 handles, a 3-line overhead per handle (header + indicator +
    // footer) would be 12 rows, exceeding the 10-row terminal. The fix
    // should drop the elision indicator so the frame still fits.
    using dir = tempDir("issue-28800-4pkg", {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        scripts: { build: script("a", 8) },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        scripts: { build: script("b", 8) },
      }),
      "packages/pkg-c/package.json": JSON.stringify({
        name: "pkg-c",
        scripts: { build: script("c", 8) },
      }),
      "packages/pkg-d/package.json": JSON.stringify({
        name: "pkg-d",
        scripts: { build: script("d", 8) },
      }),
    });

    const { output, exitCode } = await runFilter(String(dir), 10);
    assertFramesFit(output, 10);
    expect(exitCode).toBe(0);
  });
});
