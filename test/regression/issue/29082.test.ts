// https://github.com/oven-sh/bun/issues/29082
//
// `console.table` was writing string cell values unquoted. If the string
// contained `\n`, `\r`, or `\t`, the embedded control character landed in
// the middle of the row and broke the table border. For each such case,
// Bun now promotes the cell to the JSON-escaped (quoted) form — matching
// how inspect() already prints top-level strings — so the table stays
// intact.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runTable(code: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.exited,
  ]);
  expect(exitCode).toBe(0);
  return stdout;
}

// The table border is made of repeating ─ characters. After the fix, every
// `│`-delimited row must contain exactly the same number of `│` separators
// as the header — if any cell leaked an embedded newline, the row count
// would increase.
function assertRectangular(out: string) {
  const lines = out.split("\n").filter(l => l.trim().length > 0);
  // Collect only lines that are table-interior rows (start with `│`).
  const rows = lines.filter(l => l.startsWith("│"));
  expect(rows.length).toBeGreaterThan(0);
  const expectedBars = rows[0]!.split("│").length;
  for (const row of rows) {
    expect(row.split("│").length).toBe(expectedBars);
  }
}

test("console.table escapes embedded newlines so the row stays on one line", async () => {
  const out = await runTable(`console.table([{ foo: 123, bar: "Hello\\nWorld" }]);`);
  assertRectangular(out);
  expect(out).toContain(`"Hello\\nWorld"`);
  // And importantly, the literal newline must NOT be present inside a cell.
  // Count lines between the top border `┌...┐` and the bottom `└...┘`:
  // there should be exactly 3 (header row, separator, one data row).
  const body = out.split("\n").slice(1, -2); // strip top border + trailing
  const dataRows = body.filter(l => l.startsWith("│"));
  expect(dataRows.length).toBe(2); // header + single data row
});

test("console.table escapes embedded carriage returns", async () => {
  const out = await runTable(`console.table([{ bar: "Line1\\rLine2" }]);`);
  assertRectangular(out);
  expect(out).toContain(`"Line1\\rLine2"`);
});

test("console.table escapes embedded tabs", async () => {
  const out = await runTable(`console.table([{ bar: "tab\\there" }]);`);
  assertRectangular(out);
  expect(out).toContain(`"tab\\there"`);
});

test("console.table leaves plain strings unquoted", async () => {
  const out = await runTable(`console.table([{ foo: 123, bar: "Hello World" }]);`);
  assertRectangular(out);
  expect(out).toContain("Hello World");
  // Plain strings are NOT promoted to the quoted form.
  expect(out).not.toContain(`"Hello World"`);
  expect(out).not.toContain(`'Hello World'`);
});

test("console.table handles multiple newline cells in the same table", async () => {
  const out = await runTable(
    `console.table([{ a: 1, b: "a\\nb\\nc" }, { a: 2, b: "plain" }]);`,
  );
  assertRectangular(out);
  expect(out).toContain(`"a\\nb\\nc"`);
  expect(out).toContain("plain");
});

test("console.table escapes newlines in Map values", async () => {
  const out = await runTable(
    `console.table(new Map([["k1", "v1"], ["k2", "v\\n2"]]));`,
  );
  assertRectangular(out);
  expect(out).toContain(`"v\\n2"`);
});

test("console.table escapes newlines in Set values", async () => {
  const out = await runTable(`console.table(new Set(["a", "b\\nc"]));`);
  assertRectangular(out);
  expect(out).toContain(`"b\\nc"`);
});

test("console.table escapes newlines in primitive arrays", async () => {
  const out = await runTable(`console.table(["hi", "a\\nb", "foo"]);`);
  assertRectangular(out);
  expect(out).toContain(`"a\\nb"`);
  // Plain entries should stay unquoted.
  const rows = out.split("\n").filter(l => l.startsWith("│"));
  expect(rows.some(r => r.includes(" hi "))).toBe(true);
  expect(rows.some(r => r.includes(" foo "))).toBe(true);
});

test("console.table with properties arg respects newline escaping", async () => {
  const out = await runTable(
    `console.table([{a:1, b:"x\\ny"}, {a:2, b:"normal"}], ["b"]);`,
  );
  assertRectangular(out);
  expect(out).toContain(`"x\\ny"`);
  expect(out).toContain("normal");
});
