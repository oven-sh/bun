import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// An `npm:` alias that bun knows sends a plain dependency with the name of the alias to the alias target. The
// dependency parser registers each alias it reads when its last argument is the package manager. A lockfile must
// not do that: bun can discard the lockfile after it read the row, and the alias then decides the next resolve.
// The caller that keeps the lockfile registers its rows (`Lockfile::record_dependency_row_aliases`).
//
// The loaders of bun.lock and bun.lockb and the package-lock.json migration hold no `&mut PackageManager`, so the
// compiler keeps them from it. These migrations hold one for other work. A new migration joins the list.
const migrations = ["src/install/yarn.rs", "src/install/pnpm.rs"];
const parserCall = /\b(?:[Dd]ependency::parse|parse_with_tag|parse_with_optional_tag)\s*\(/g;

/** The arguments of the call whose "(" is at `open`. */
function callArguments(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i++) {
    const char = code[i];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    if (depth === 0 || (depth === 1 && char === ",")) {
      const arg = code.slice(start, i).trim();
      if (arg) args.push(arg);
      start = i + 1;
    }
    if (depth === 0) break;
  }
  return args;
}

test("callArguments splits at the commas of the call itself", () => {
  const code = "parse(name, Some(hash), &sliced.sub(&str[0..i]), None,\n)";
  expect(callArguments(code, code.indexOf("("))).toEqual(["name", "Some(hash)", "&sliced.sub(&str[0..i])", "None"]);
});

test("a lockfile migration gives the dependency parser no alias registry", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const violations: string[] = [];
  let calls = 0;
  for (const file of migrations) {
    // The whole file, so that a call broken over several lines is seen. Line comments go, newlines stay.
    const code = readFileSync(path.join(repoRoot, file), "utf8").replace(/\/\/.*$/gm, "");
    for (const match of code.matchAll(parserCall)) {
      calls++;
      const registry = callArguments(code, match.index + match[0].length - 1).at(-1);
      if (registry !== "None") {
        violations.push(`${file}:${code.slice(0, match.index).split("\n").length}: ${registry}`);
      }
    }
  }
  // The two migrations have eleven calls. None at all means they moved and this lint checks nothing.
  expect(calls).toBeGreaterThan(5);
  expect(violations).toEqual([]);
});
