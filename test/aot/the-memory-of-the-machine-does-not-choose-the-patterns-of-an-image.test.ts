// Runs alone: it builds one program four times.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

// A build runs the start of a program ahead of time to learn which patterns it makes, and that run ends at a count of what
// it has made. It may not end at what its heap holds: that hangs on the memory of the machine and on when the collector ran.
// This program makes far more than the count books, drops a fourth of it for the collector, and makes a pattern in every turn.
const program = `"use strict";
function load(turns) {
  const kept = [];
  const shape = {};
  for (let k = 0; k < 1000; k++) shape["k" + k] = k;
  for (let i = 0; i < turns; i++) {
    const list = Object.entries(shape);
    if (i % 4 !== 0) kept[i] = list;
    new RegExp("t" + i);
  }
  return kept.length;
}
if (process.argv[3] === "hoard") console.log(load(7000));
function word(n) { return "a" + (n % 7); }
console.log(new RegExp(word(9)).source);
`;

async function imageBuiltWith(folder: string, memory: string) {
  const outfile = join(folder, "program" + (isWindows ? ".exe" : ""));
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./program.cjs", "--outfile", outfile],
    cwd: folder,
    env: { ...bunEnv, BUN_JSC_forceRAMSize: memory },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  return createHash("sha256").update(readFileSync(outfile)).digest("hex");
}

test("one program gives one image on a machine of one gigabyte and on one of sixty-four", async () => {
  using dir = tempDir("aot-one-image-whatever-the-memory", {});
  const folder = String(dir);
  writeFileSync(join(folder, "program.cjs"), program);
  const images = new Set<string>();
  for (const gigabytes of [1, 64, 1, 8])
    images.add(await imageBuiltWith(folder, String(gigabytes * 1024 * 1024 * 1024)));
  expect(images.size).toBe(1);
}, 240_000);
