// https://github.com/oven-sh/bun/issues/29082
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runTable(code: string): Promise<{ stdout: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
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

test("console.table escapes embedded newlines so the row stays on one line", async () => {
  const { stdout, exitCode } = await runTable(`console.table([{ foo: 123, bar: "Hello\\nWorld" }]);`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"Hello\\nWorld"`);
  // One data row only — no extra line from a leaked `\n`.
  const dataRows = stdout.split("\n").filter(l => l.startsWith("│"));
  expect(dataRows.length).toBe(2); // header + one data row
  expect(exitCode).toBe(0);
});

test("console.table escapes embedded carriage returns", async () => {
  const { stdout, exitCode } = await runTable(`console.table([{ bar: "Line1\\rLine2" }]);`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"Line1\\rLine2"`);
  expect(exitCode).toBe(0);
});

test("console.table escapes embedded tabs", async () => {
  const { stdout, exitCode } = await runTable(`console.table([{ bar: "tab\\there" }]);`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"tab\\there"`);
  expect(exitCode).toBe(0);
});

test("console.table leaves plain strings unquoted", async () => {
  const { stdout, exitCode } = await runTable(`console.table([{ foo: 123, bar: "Hello World" }]);`);
  assertRectangular(stdout);
  expect(stdout).toContain("Hello World");
  // Plain strings are NOT promoted to the quoted form.
  expect(stdout).not.toContain(`"Hello World"`);
  expect(stdout).not.toContain(`'Hello World'`);
  expect(exitCode).toBe(0);
});

test("console.table handles multiple newline cells in the same table", async () => {
  const { stdout, exitCode } = await runTable(`console.table([{ a: 1, b: "a\\nb\\nc" }, { a: 2, b: "plain" }]);`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"a\\nb\\nc"`);
  expect(stdout).toContain("plain");
  expect(exitCode).toBe(0);
});

test("console.table escapes newlines in Map values", async () => {
  const { stdout, exitCode } = await runTable(`console.table(new Map([["k1", "v1"], ["k2", "v\\n2"]]));`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"v\\n2"`);
  expect(exitCode).toBe(0);
});

test("console.table escapes newlines in Set values", async () => {
  const { stdout, exitCode } = await runTable(`console.table(new Set(["a", "b\\nc"]));`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"b\\nc"`);
  expect(exitCode).toBe(0);
});

test("console.table escapes newlines in primitive arrays", async () => {
  const { stdout, exitCode } = await runTable(`console.table(["hi", "a\\nb", "foo"]);`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"a\\nb"`);
  // Plain entries stay unquoted.
  const rows = stdout.split("\n").filter(l => l.startsWith("│"));
  expect(rows.some(r => r.includes(" hi "))).toBe(true);
  expect(rows.some(r => r.includes(" foo "))).toBe(true);
  expect(exitCode).toBe(0);
});

test("console.table with properties arg respects newline escaping", async () => {
  const { stdout, exitCode } = await runTable(`console.table([{a:1, b:"x\\ny"}, {a:2, b:"normal"}], ["b"]);`);
  assertRectangular(stdout);
  expect(stdout).toContain(`"x\\ny"`);
  expect(stdout).toContain("normal");
  expect(exitCode).toBe(0);
});
