import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

// differential/mod_hash/dict_reentrant_eq.py has an __eq__ do 15 things to the dict that is asking it, under 13 operations. What it
// compares with CPython are the cases that CPython 3.15 comes through itself (its header says which it does not). With "all" it goes
// through the others too, 14,040 in all: there is nothing to compare them with, but the process has to come through.
test(
  "an __eq__ that changes the dict that is asking it: every case",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "differential", "mod_hash", "dict_reentrant_eq.py"), "all"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n").map(line => line.split(" ").slice(2).join(" "))).toEqual(
      Array(30).fill("468 cases not compared not counted"),
    );
    expect(exitCode).toBe(0);
  },
  isDebug || isASAN ? 600_000 : 60_000,
);
