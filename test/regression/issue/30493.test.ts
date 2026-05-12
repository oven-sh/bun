// https://github.com/oven-sh/bun/issues/30493
//
// `require()` of an ESM module whose graph contains a diamond dependency
// through a barrel deadlocked (release) / aborted on `ASSERTION FAILED:
// m_status == Status::Fetching` at ModuleRegistryEntry.cpp:254 (debug).
// Regressed by the require(esm) sync-replay path; same root cause as
// #30281 — `moduleRegistryModuleSettled` fired twice for the same entry
// when `hostLoadImportedModule`'s synchronous-replay branch had already
// driven `fetchComplete` inline while a stale normal-queue reaction was
// still pending. Fix: oven-sh/WebKit#217.
//
// This is the dependency-free reduction of #30281; the react + MUI
// variant is covered separately in 30281.test.ts.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("require() of ESM with diamond dependency through barrel does not deadlock", async () => {
  using dir = tempDir("issue-30493", {
    // shared.js: imports a synthetic builtin so its fetch goes through
    // the normal microtask queue *before* the require(esm) entry point
    // switches to synchronous draining — that ordering is what leaves a
    // stale ModuleRegistryModuleSettled reaction queued. `path.posix.sep`
    // so the snapshot is platform-stable.
    "shared.js": `import path from 'path';\nexport const SHARED = path.posix.sep;\n`,
    "barrel.js": `import { SHARED } from './shared.js';\nexport { SHARED };\nexport const BARREL = 'barrel';\n`,
    "a.js": `import { SHARED } from './barrel.js';\nexport default function a() { return SHARED; }\n`,
    "b.js": `import { BARREL } from './barrel.js';\nexport default function b() { return BARREL; }\n`,
    "app.js": `import a from './a.js';\nimport b from './b.js';\nimport { SHARED } from './shared.js';\nexport default { a: a(), b: b(), shared: SHARED };\n`,
    "entry.js": `const mod = require('./app.js');\nconsole.log(JSON.stringify(mod.default));\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Before the fix: release builds deadlock indefinitely; debug builds
  // abort. signalAfter forces a clean failure for the deadlock case so
  // the test reports stderr rather than timing out the whole file.
  const KILL_SIGNAL = "SIGTERM";
  const KILL_AFTER_MS = 5_000;
  const killer = setTimeout(() => proc.kill(KILL_SIGNAL), KILL_AFTER_MS);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(killer);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"{"a":"/","b":"barrel","shared":"/"}"`);
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(proc.signalCode).not.toBe(KILL_SIGNAL);
  expect(exitCode).toBe(0);
});
