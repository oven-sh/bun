// Shared by the differential tests of `src/lint/linter`.
//
// Each test generates cases, asks the real implementation (ESLint, @eslint/plugin-kit,
// @eslint/config-array, V8) and `bun-lint linter ..` for the answer, and prints where they differ.
//
//   ESLINT_DIR=<checkout of eslint with node_modules> BUN_LINT=<bun-lint> node <test>.mjs
//
// Run them with Node.js: ESLint quotes the messages of V8's `JSON.parse`.

import { execFileSync, spawnSync } from "node:child_process";
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

/**
 * What `-f json` of oxlint, or of `bun lint` with a configuration of oxlint, says: for each file the reports as texts, sorted: of each
 * label where it starts, how long it is, its line and its column, then the code, the severity and the message. Not the `url`, the
 * `help` and the texts of labels. `null`: it is not JSON: the configuration is refused.
 */
export function reportsOfOxlint(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const byFile = {};
  for (const { filename, labels, code = null, severity, message } of parsed.diagnostics) {
    const places = labels.map(({ span }) => [span.offset, span.length, span.line, span.column]);
    (byFile[filename] ??= []).push(JSON.stringify([places, code, severity, message]));
  }
  for (const rows of Object.values(byFile)) rows.sort();
  return byFile;
}

/**
 * Counts in how many of the things that it is given (projects, files) two answers of `reportsOfOxlint` are the same.
 * `withoutRefused`: not the files about which one of the two says something without a code: it refuses them.
 */
export function strictly(name, { withoutRefused = false, show = 6 } = {}) {
  let [same, differ, refused] = [0, 0, 0];
  return {
    add(what, expected, actual) {
      if (expected === null || actual === null) return void refused++;
      const isRefused = rows => withoutRefused && (rows ?? []).some(it => JSON.parse(it)[1] === null);
      const files = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
        .filter(it => !isRefused(expected[it]) && !isRefused(actual[it]))
        .sort();
      const only = (one, other) => files.flatMap(it => (one[it] ?? []).filter(row => !(other[it] ?? []).includes(row)).map(row => `${it} ${row}`));
      if (files.every(it => isDeepStrictEqual(expected[it] ?? [], actual[it] ?? []))) return void same++;
      if (differ++ < show) {
        console.log(`──── ${name} ${what}`);
        for (const it of only(expected, actual).slice(0, 4)) console.log(`only oxlint:   ${it}`);
        for (const it of only(actual, expected).slice(0, 4)) console.log(`only bun lint: ${it}`);
      }
    },
    report() {
      if (refused > 0) console.log(`${name}: ${refused} left out, one of the two refuses the configuration`);
      console.log(`${name}: ${same} of ${same + differ} agree`);
      if (differ > 0) process.exitCode = 1;
    },
  };
}

/** `bun lint <args>` in `cwd`: what it prints. */
export function bunLintPrints(args, cwd) {
  const env = { ...process.env, AGENT: "0", NO_COLOR: "1" };
  return spawnSync(bunLint, ["cli", ...args], { cwd, env, maxBuffer: 1 << 28 }).stdout.toString();
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
