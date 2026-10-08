// Shared by the differential tests of `src/lint/linter`.
//
// Each test generates cases, asks the real implementation (ESLint, @eslint/plugin-kit,
// @eslint/config-array, V8) and `bun-lint linter ..` for the answer, and prints where they differ.
//
//   ESLINT_DIR=<checkout of eslint with node_modules> BUN_LINT=<bun-lint> node <test>.mjs
//
// Run them with Node.js: ESLint quotes the messages of V8's `JSON.parse`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const eslintDir = resolve(process.env.ESLINT_DIR ?? "eslint");
export const bunLint = resolve(process.env.BUN_LINT ?? "bun-lint");
export const requireFromEslint = createRequire(join(eslintDir, "package.json"));

/** Runs `bun-lint linter <command>` on `cases` and returns what it prints, parsed. */
export function runBunLint(command, cases) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bun-lint-oracle-"));
  try {
    const file = join(dir, "cases.json");
    writeFileSync(file, JSON.stringify(cases));
    const out = execFileSync(bunLint, ["linter", command, file], { maxBuffer: 1 << 30 });
    return JSON.parse(out.toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A small deterministic random number generator. */
export function random(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: n => Math.floor(next() * n),
    pick: list => list[Math.floor(next() * list.length)],
  };
}

/** Prints the cases whose answers differ, and sets the exit code. */
export function report(name, cases, expected, actual, limit = 20) {
  let failed = 0;
  for (let i = 0; i < cases.length; i++) {
    if (isDeepStrictEqual(expected[i], actual[i])) continue;
    if (failed++ < limit) {
      console.log(`──── ${name} #${i}\ncase:     ${JSON.stringify(cases[i])}`);
      console.log(`expected: ${JSON.stringify(expected[i])}\nactual:   ${JSON.stringify(actual[i])}`);
    }
  }
  console.log(`${name}: ${cases.length - failed} of ${cases.length} agree`);
  if (failed > 0) process.exitCode = 1;
}
