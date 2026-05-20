// Regression test for https://github.com/oven-sh/bun/issues/31149.
//
// When `install.security.scanner` is set in the global `~/.bunfig.toml`,
// `bun create` scaffolds into a fresh project that has no way to list the
// scanner as a dependency. Before the fix, the child `bun install` spawned
// by `bun create` tripped the "scanner not in root deps" guard and aborted
// with `SecurityScannerNotInDependencies` — the scaffolded project never
// finished being created.
//
// The fix exports `BUN_INTERNAL_SKIP_SECURITY_SCANNER=true` from `bun create`
// so every descendant `bun install` short-circuits the scanner for that one
// run. Standalone `bun install` is unaffected.
//
// This test is in its own file so the gate can evaluate it without being
// confused by pre-existing GitHub/network-flaky tests in bun-create.test.ts.

import { spawn } from "bun";
import { beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env, tmpdirSync } from "harness";
import { join } from "path";

let x_dir: string;
let testNumber = 0;
beforeEach(() => {
  x_dir = tmpdirSync(`bun-create-scanner-${testNumber++}`);
});

it("bun create succeeds when install.security.scanner is set in global bunfig", async () => {
  const fakeHome = join(x_dir, "fake-home");
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "scanner-test";

  await Bun.write(
    join(fakeHome, ".bunfig.toml"),
    `[install.security]\nscanner = "@socketsecurity/bun-security-scanner"\n`,
  );

  // Template with a trivial dependency so `bun install` is actually invoked
  // by `bun create` (it's skipped when the template has no deps at all).
  await Bun.write(
    join(bunCreateDir, testTemplate, "package.json"),
    JSON.stringify({
      name: "scanner-template",
      version: "0.0.1",
      dependencies: { "is-number": "7.0.0" },
    }),
  );

  const destination = join(x_dir, "dest-scanner");
  const { exited, stderr, stdout } = spawn({
    cmd: [bunExe(), "create", testTemplate, destination, "--no-git"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    // `env -i`-style isolation so the host's real `~/.bunfig.toml` can't
    // interfere. Global bunfig loading reads `XDG_CONFIG_HOME` first, falling
    // back to `HOME` (POSIX) or `USERPROFILE` (Windows) — set all three so the
    // fake global bunfig is picked up regardless of platform.
    env: {
      ...env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      XDG_CONFIG_HOME: fakeHome,
      BUN_CREATE_DIR: bunCreateDir,
    },
  });

  const [err, out, _exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

  // The signal we care about is the scanner NOT tripping, so that scaffolding
  // reaches the "Created …" success line. We deliberately don't assert on the
  // exit code: `bun install` inside `bun create` can still fail to resolve
  // `is-number` (no npm access in sandboxed/ASAN lanes), and pre-fix that same
  // install would have tripped the scanner check long before reaching the
  // resolve step. The absence of the scanner errors *plus* the success line is
  // what proves the fix.
  expect(out + err).not.toContain("SecurityScannerNotInDependencies");
  expect(out + err).not.toContain("is configured in bunfig.toml but is not installed");
  expect(out).toContain(`Created ${testTemplate} project successfully`);
}, 20_000);
