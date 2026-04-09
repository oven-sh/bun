// https://github.com/oven-sh/bun/issues/29082
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runTable(code: string): Promise<{ stdout: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drain stderr even though we don't inspect it — leaving it buffered would
  // deadlock once the child wrote >~64KB to stderr.
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode };
}

// Every `│`-delimited row must have the same number of separators as the
// header — if any cell leaked an embedded newline, the count would differ.
function assertRectangular(out: string) {
  const rows = out
    .split("\n")
    .filter(l => l.trim().length > 0)
    .filter(l => l.startsWith("│"));
  expect(rows.length).toBeGreaterThan(0);
  const expectedBars = rows[0]!.split("│").length;
  for (const row of rows) {
    expect(row.split("│").length).toBe(expectedBars);
  }
}

describe.concurrent("console.table quotes cells containing control characters", () => {
  test("newline keeps the row on a single line", async () => {
    const { stdout, exitCode } = await runTable(`console.table([{ foo: 123, bar: "Hello\\nWorld" }]);`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"Hello\\nWorld"`);
    // No raw literal newline mid-cell.
    expect(stdout).not.toMatch(/│[^│\n]*Hello\n/);
    expect(exitCode).toBe(0);
  });

  test("carriage return", async () => {
    const { stdout, exitCode } = await runTable(`console.table([{ bar: "Line1\\rLine2" }]);`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"Line1\\rLine2"`);
    expect(exitCode).toBe(0);
  });

  test("tab", async () => {
    const { stdout, exitCode } = await runTable(`console.table([{ bar: "tab\\there" }]);`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"tab\\there"`);
    expect(exitCode).toBe(0);
  });

  test("other C0 control chars (vertical tab, form feed, NUL)", async () => {
    // \v (0x0B), \f (0x0C), and \0 (NUL) also move the cursor or mismatch
    // the visible-width calculation — the fix covers the full C0 range
    // (0x00–0x1F except ESC), not just \n/\r/\t.
    const { stdout, exitCode } = await runTable(`console.table([{ bar: "a\\vb\\fc\\x00d" }]);`);
    assertRectangular(stdout);
    // Positive: cell rendered in its JSON-escaped form — \v/\f as short
    // escapes, NUL as \u0000.
    expect(stdout).toContain(`"a\\vb\\fc\\u0000d"`);
    // Negative: no C0 char survives raw (ESC 0x1B excluded — see ANSI test).
    expect(stdout).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/);
    expect(exitCode).toBe(0);
  });

  test("ANSI escape sequences (ESC) pass through unescaped so colors survive", async () => {
    // 0x1B is the first byte of every ANSI color sequence. VisibleCharacterCounter
    // already strips ANSI from the width calculation, so quoting these strings
    // would destroy chalk/picocolors output without fixing any layout bug.
    const { stdout, exitCode } = await runTable(
      `console.table([{ status: "\\x1b[31mFAIL\\x1b[0m" }, { status: "\\x1b[32mOK\\x1b[0m" }]);`,
    );
    assertRectangular(stdout);
    // Cells contain the raw ESC bytes, NOT the JSON-escaped form.
    expect(stdout).toContain("\x1b[31mFAIL\x1b[0m");
    expect(stdout).toContain("\x1b[32mOK\x1b[0m");
    expect(stdout).not.toContain("\\u001b");
    expect(stdout).not.toContain("\\u001B");
    expect(exitCode).toBe(0);
  });

  test("plain strings stay unquoted", async () => {
    const { stdout, exitCode } = await runTable(`console.table([{ foo: 123, bar: "Hello World" }]);`);
    assertRectangular(stdout);
    expect(stdout).toContain("Hello World");
    // Plain strings are NOT promoted to the quoted form.
    expect(stdout).not.toContain(`"Hello World"`);
    expect(stdout).not.toContain(`'Hello World'`);
    expect(exitCode).toBe(0);
  });

  test("multiple newline cells in the same table", async () => {
    const { stdout, exitCode } = await runTable(`console.table([{ a: 1, b: "a\\nb\\nc" }, { a: 2, b: "plain" }]);`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"a\\nb\\nc"`);
    expect(stdout).toContain("plain");
    expect(exitCode).toBe(0);
  });

  test("newlines in Map values", async () => {
    const { stdout, exitCode } = await runTable(`console.table(new Map([["k1", "v1"], ["k2", "v\\n2"]]));`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"v\\n2"`);
    expect(exitCode).toBe(0);
  });

  test("newlines in Set values", async () => {
    const { stdout, exitCode } = await runTable(`console.table(new Set(["a", "b\\nc"]));`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"b\\nc"`);
    expect(exitCode).toBe(0);
  });

  test("newlines in primitive arrays", async () => {
    const { stdout, exitCode } = await runTable(`console.table(["hi", "a\\nb", "foo"]);`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"a\\nb"`);
    // Plain entries stay unquoted.
    const rows = stdout.split("\n").filter(l => l.startsWith("│"));
    expect(rows.some(r => r.includes(" hi "))).toBe(true);
    expect(rows.some(r => r.includes(" foo "))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("properties arg respects newline escaping", async () => {
    const { stdout, exitCode } = await runTable(`console.table([{a:1, b:"x\\ny"}, {a:2, b:"normal"}], ["b"]);`);
    assertRectangular(stdout);
    expect(stdout).toContain(`"x\\ny"`);
    expect(stdout).toContain("normal");
    expect(exitCode).toBe(0);
  });
});
