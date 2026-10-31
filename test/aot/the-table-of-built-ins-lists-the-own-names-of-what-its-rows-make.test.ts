// A row of the table of built-ins that calls its result fresh says that the call makes a new object, which has the prototype of the class that the row names and holds the names that the row and
// the class list, and no others. The compiler takes a read of any other name on it for `undefined`. built-ins-alone/fresh-results.ts calls each such row, in a process of its own, and holds what
// it made against the row: own keys, symbols too, the objects above it, what it holds in its slots, fields and properties, and that a second call makes another object. So it does with what a row
// says native code makes and hands to a function of the program. A row that no test can call stands in built-ins-alone/fresh-results-calls.ts with the reason.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";
import type { Found } from "./built-ins-alone/fresh-results";
import { findBuiltinTable } from "./harness/builtin-table";
import { test } from "./supported";

const table = findBuiltinTable(bunExe());

// The calls that are written by hand name commands and paths of POSIX.
test.skipIf(table === undefined || isWindows)(
  "what a row of the table of built-ins makes holds the names that the row and its class list",
  () => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--expose-internals", join(import.meta.dir, "built-ins-alone/fresh-results.ts"), table!],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const last = stdout.toString().trimEnd().split("\n").at(-1)!;
    if (!last.startsWith("{")) throw new Error(stderr.toString().slice(-4000));
    const found = JSON.parse(last) as Found;
    expect(found.wrong).toEqual([]);
    expect(new Set(found.judged).size).toBeGreaterThan(450);
    expect(exitCode).toBe(0);
  },
  600_000,
);
