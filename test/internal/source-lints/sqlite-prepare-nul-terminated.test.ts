import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQLite parses SQL text in place only when the text ends in a NUL. With a byte length and no NUL at
// text[nByte - 1], sqlite3_prepare copies all nByte bytes before it parses one statement. A loop that gives it the
// rest of the text for each statement copies the rest once for each statement: db.exec() of one string of 160,000
// statements took 28 s.
//
// Give sqlite3_prepare* text that ends in a NUL and nByte -1: NulTerminatedSQL in JSSQLStatement.cpp, or
// tryGetUTF8() with legacyCStringPointer(). Do not pass -1 with UTF8View::span(): a borrowed ASCII string has no NUL.
const directory = path.resolve(import.meta.dir, "..", "..", "..", "src", "jsc", "bindings", "sqlite");

// Calls that may pass a length, counted for each file.
const allowed: Record<string, number> = {
  // NulTerminatedSQL::prepare passes the length of text over SQLITE_LIMIT_SQL_LENGTH, which SQLite refuses unread.
  "JSSQLStatement.cpp": 1,
};

function prepareCallsWithALength(source: string): number[] {
  // Comments and string literals become spaces, so that a parenthesis or a comma in them is not counted.
  const code = source.replace(/\/\/.*$|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/gm, text =>
    text.replace(/[^\n]/g, " "),
  );
  const lines: number[] = [];
  for (const call of code.matchAll(/\bsqlite3_prepare(?:16)?(?:_v[23])?\s*\(/g)) {
    const args = [""];
    let depth = 1;
    for (let i = call.index + call[0].length; depth > 0 && i < code.length; i++) {
      const c = code[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      if (depth === 1 && c === ",") args.push("");
      else if (depth > 0) args[args.length - 1] += c;
    }
    if (args[2]?.trim() !== "-1") lines.push(code.slice(0, call.index).split("\n").length);
  }
  return lines;
}

test("sqlite3_prepare* gets SQL text that ends in a NUL, with nByte -1", async () => {
  const withALength: string[] = [];
  const staleAllowance: string[] = [];
  let scanned = 0;
  for await (const name of new Glob("*.cpp").scan({ cwd: directory })) {
    scanned++;
    const lines = prepareCallsWithALength(readFileSync(path.join(directory, name), "utf8"));
    const allowance = allowed[name] ?? 0;
    if (lines.length > allowance) withALength.push(...lines.map(line => `${name}:${line}`));
    if (lines.length < allowance) staleAllowance.push(`${name}: ${lines.length} calls, ${allowance} allowed`);
  }
  // A wrong directory would make the check pass with nothing scanned.
  expect(scanned).toBeGreaterThan(0);
  expect({ withALength: withALength.sort(), staleAllowance }).toEqual({ withALength: [], staleAllowance: [] });
});
