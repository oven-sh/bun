import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const count = 64;
const line = "const a = {b:1,  c:'two'}\n";

/**
 * Runs `bun fmt` on `count` files and counts the different random numbers in the names of their temporary files.
 * `bun fmt` first writes each file as `.<16 hex digits>.tmp`, a number that the formatting thread draws from
 * `bun_core::fast_random()`. The first file is large, so one thread is still formatting it while the others write.
 */
async function temporaryNames(env: Record<string, string>) {
  const files = Object.fromEntries(Array.from({ length: count }, (_, i) => [`${i}.js`, line]));
  files["0.js"] = Buffer.alloc(20_000 * line.length, line).toString();
  using dir = tempDir("bun-format-temporary-name", files);
  const random = new Set<string>();
  const { promise: sawLast, resolve, reject } = Promise.withResolvers<void>();
  const watcher = watch(String(dir), (_, name) => {
    if (name === "last") resolve();
    else if (name?.endsWith(".tmp")) random.add(name.slice(1, 17));
  });
  watcher.on("error", reject);
  try {
    await using proc = spawn({
      cmd: [bunExe(), "fmt"],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Events arrive in order, so every temporary file has been reported once this file is.
    writeFileSync(join(String(dir), "last"), "");
    await sawLast;
    return { stderr, distinct: random.size, exitCode };
  } finally {
    watcher.close();
  }
}

const everyNameDiffers = {
  stderr: expect.stringContaining(`Formatted ${count} files, 0 unchanged`),
  distinct: count,
  exitCode: 0,
};

// Every thread once drew the same numbers. Only inotify is known to report every short-lived file, in order.
test.concurrent.skipIf(!isLinux)("bun fmt gives every file of a run its own temporary name", async () => {
  expect(await temporaryNames({})).toEqual(everyNameDiffers);
});

// The seed gives every run the same numbers. Only a build with assertions reads it.
test.concurrent.skipIf(!isLinux || !(isDebug || isASAN))(
  "bun fmt gives every file of a run its own temporary name when BUN_DEBUG_HASH_RANDOM_SEED is set",
  async () => {
    expect(await temporaryNames({ BUN_DEBUG_HASH_RANDOM_SEED: "42" })).toEqual(everyNameDiffers);
  },
);
