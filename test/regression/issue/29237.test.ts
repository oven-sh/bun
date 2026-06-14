// Regression test for https://github.com/oven-sh/bun/issues/29237
// child_process sync variants (execFileSync, spawnSync, execSync) must
// resolve commands using the *current* process.env.PATH when options.env
// is omitted — not a stale snapshot captured at Bun startup.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import path from "node:path";

test.skipIf(isWindows)("execFileSync/spawnSync/execSync honor runtime mutations to process.env.PATH", async () => {
  using dir = tempDir("issue-29237", {
    // Fake `marker` binary — whichever PATH entry wins gets called.
    "fake/marker": '#!/bin/sh\necho "FAKE_CALLED"\n',
    "fixture.js": `
        const { execFileSync, spawnSync, execSync } = require("node:child_process");
        const path = require("node:path");

        // Prepend our fake-binary dir to PATH at runtime.
        const fakeDir = path.join(__dirname, "fake");
        process.env.PATH = fakeDir + path.delimiter + process.env.PATH;

        // 1. execFileSync without explicit env — must use mutated PATH.
        const a = execFileSync("marker", { encoding: "utf8" }).trim();
        console.log("execFileSync:", a);

        // 2. spawnSync without explicit env.
        const b = spawnSync("marker", [], { encoding: "utf8" });
        console.log("spawnSync:", (b.stdout || "").trim());

        // 3. execSync without explicit env.
        const c = execSync("marker", { encoding: "utf8" }).trim();
        console.log("execSync:", c);

        // 4. execFileSync *with* explicit env — sanity check, already worked.
        const d = execFileSync("marker", { encoding: "utf8", env: process.env }).trim();
        console.log("execFileSync+env:", d);
      `,
  });

  // chmod the fake binary so it's executable — tempDir writes 0644 by default.
  chmodSync(path.join(String(dir), "fake", "marker"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Surface any subprocess stderr on assertion failure for diagnosis.
  if (exitCode !== 0) console.error("fixture stderr:", stderr);

  // Assert stdout first for better failure messages, then exit code.
  expect(stdout).toBe(
    "execFileSync: FAKE_CALLED\n" +
      "spawnSync: FAKE_CALLED\n" +
      "execSync: FAKE_CALLED\n" +
      "execFileSync+env: FAKE_CALLED\n",
  );
  expect(exitCode).toBe(0);
});
