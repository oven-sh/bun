// Temporary: see zz-diagnose-preload.js.
import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { join } from "node:path";

test("diagnose", async () => {
  const root = join(import.meta.dir, "../../../..");
  const file = join(root, "test/js/node/test/parallel/test-http-client-leaky-with-double-response.js");
  for (const mode of ["log", "zero"]) {
    const preload = mode === "control" ? [] : ["--preload", join(import.meta.dir, "zz-diagnose-preload.js")];
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--config=" + join(root, "bunfig.node-test.toml"), ...preload, file],
      cwd: root,
      env: { ...process.env, DIAG_MODE: mode, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: mode === "control" ? 5_000 : 25_000,
    });
    const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    console.log(`DIAG ===== ${mode}: code ${code} signal ${proc.signalCode}`);
    for (const line of (stdout + stderr).split("\n")) console.log("DIAG " + line);
  }
  expect("diagnostic").toBe("removed");
}, 85_000);
