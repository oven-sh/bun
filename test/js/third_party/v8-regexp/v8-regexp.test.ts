// Runs V8's mjsunit RegExp test corpus (see README.md) against bun. Each file
// runs in a fresh subprocess in sloppy script mode, mirroring V8's d8 harness.
// The same files run under node via run-under-node.mjs, which acts as an
// oracle: a file that passes there but fails here is a bun/JSC divergence.
import { expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

const dir = import.meta.dir;
const runner = join(dir, "one-file.mjs");
const corpusDir = join(dir, "mjsunit");

// Files that exercise known, pre-existing JSC-vs-V8 divergences (see
// KNOWN-DIVERGENCES.md). They are expected to fail with the recorded
// assertion; an unexpected pass means the engine bug was fixed and the
// entry should be removed.
const knownDivergences: Record<string, string> = {
  // v-mode + ignoreCase: JSC subtracts class strings before case-folding them.
  "regexp-modifiers.js": "\\q{ĀĂĄ|AaA}--\\q{āăą}",
  // JSC's may-contain-strings analysis for negated v-mode classes diverges
  // from V8's on this file's string/property cases.
  "regexp-unicode-sets.js": "negated class set may contain strings",
};

// Heavy files (large capture stress); bun runs them ~5x faster than node,
// but they still need more than the default 5s.
const slowFiles = new Set(["regexp-capture-3.js"]);

const files = readdirSync(corpusDir)
  .filter(f => f.endsWith(".js"))
  .sort();

for (const file of files) {
  test.concurrent(
    `v8 mjsunit: ${file}`,
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), runner, join(corpusDir, file)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const output = stdout + stderr;

      const divergence = knownDivergences[file];
      if (divergence !== undefined) {
        // Assert the failure is the recorded one, so a different (new)
        // regression in this file still fails loudly.
        expect(output).toContain(divergence);
        expect(exitCode).not.toBe(0);
        return;
      }
      expect(output).toContain("ok");
      expect(exitCode).toBe(0);
    },
    slowFiles.has(file) ? 120_000 : 30_000,
  );
}
