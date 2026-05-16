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

async function runFilter(cwd: string, rows: number, cols = 80, extraArgs: string[] = []) {
  const chunks: Uint8Array[] = [];
  const proc = Bun.spawn([bunExe(), ...extraArgs, "--filter", "*", "build"], {
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

  // Every *live* rendered frame must fit in `rows - 1` lines. Each emitted
  // line ends in `\n`, so N lines advance the cursor N rows from row 1 →
  // row N+1; a frame of exactly `rows` lines still scrolls the top line
  // into scrollback, which over many redraws stacks up the same stale
  // header and re-introduces the #28800 duplication. The final frame on
  // clean exit is intentionally uncapped (no subsequent redraw to corrupt
  // it, so we honor --elide-lines / dump everything for debugging), so it's
  // excluded from this check.
  const frames = [...output.matchAll(/\x1b\[\?2026h([\s\S]*?)\x1b\[\?2026l/g)].map(m => m[1]);
  expect(frames.length).toBeGreaterThan(0);
  const liveFrames = frames.slice(0, -1);
  for (const frame of liveFrames) {
    expect(countRenderedLines(frame)).toBeLessThanOrEqual(rows - 1);
  }
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

  test("--elide-lines=0 honors 'show all' on clean exit even in a short TTY", async () => {
    // During live redraws the terminal cap applies (otherwise #28800 returns),
    // but the final frame on a clean successful exit is uncapped so that the
    // documented `--elide-lines=0` = "show all lines" contract actually holds.
    using dir = tempDir("issue-28800-elide0", {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        scripts: { build: script("a", 12) },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        scripts: { build: script("b", 12) },
      }),
    });

    const { output, exitCode } = await runFilter(String(dir), 10, 80, ["--elide-lines", "0"]);
    // Last synchronized-update frame is the final dump — it must contain
    // every output line of every package without eliding anything.
    const frames = [...output.matchAll(/\x1b\[\?2026h([\s\S]*?)\x1b\[\?2026l/g)].map(m => m[1]);
    expect(frames.length).toBeGreaterThan(0);
    // Strip ANSI escapes so matching works on the rendered text. Content
    // lines are rendered with a leading "│ " prefix, distinct from the
    // script header which includes the literal printf argument, so checking
    // for "│ a-1" (etc.) actually verifies the line was rendered as content
    // rather than appearing incidentally in the printed script_content.
    const plainLastFrame = frames[frames.length - 1].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    for (const prefix of ["a", "b"]) {
      for (let i = 1; i <= 12; i++) {
        expect(plainLastFrame).toContain(`│ ${prefix}-${i}\r\n`);
      }
    }
    expect(plainLastFrame).not.toContain("lines elided");
    expect(exitCode).toBe(0);
  });
});
