import { $ } from "bun";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

// Regression tests for https://github.com/oven-sh/bun/issues/32202
// A `VAR=value cmd` prefix assignment of a variable that already exists in
// the shell environment (inherited from the process, or set earlier via
// `export`) appended a second environ entry instead of replacing the
// existing one. POSIX tolerates duplicate environ entries but getenv
// returns the first match, so the child effectively saw the stale value.
//
// The tests read the raw environ via the external `env` command: a bun
// child can't detect the bug (its `process.env` parses environ last-wins),
// and getenv-based children would see the first match. Hence posix-only.

const envLines = async (cmd: $.ShellPromise, name: string) =>
  (await cmd).text().split("\n").filter(l => l.startsWith(`${name}=`));

test.skipIf(isWindows)("prefix assignment of an inherited var replaces the environ entry", async () => {
  const saved = process.env.BUN_32202_INHERITED;
  process.env.BUN_32202_INHERITED = "parent";
  try {
    const lines = await envLines($`BUN_32202_INHERITED=child env`.quiet(), "BUN_32202_INHERITED");
    expect(lines).toEqual(["BUN_32202_INHERITED=child"]);
  } finally {
    if (saved === undefined) delete process.env.BUN_32202_INHERITED;
    else process.env.BUN_32202_INHERITED = saved;
  }
});

test.skipIf(isWindows)("prefix assignment of an exported var replaces the environ entry", async () => {
  const lines = await envLines(
    $`export BUN_32202_EXPORTED=first; BUN_32202_EXPORTED=second env`.quiet(),
    "BUN_32202_EXPORTED",
  );
  expect(lines).toEqual(["BUN_32202_EXPORTED=second"]);
});

test.skipIf(isWindows)("prefix assignment of a fresh var stays a single entry", async () => {
  const lines = await envLines($`BUN_32202_FRESH=only env`.quiet(), "BUN_32202_FRESH");
  expect(lines).toEqual(["BUN_32202_FRESH=only"]);
});
