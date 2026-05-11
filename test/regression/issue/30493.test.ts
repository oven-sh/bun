import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/30493
//
// Regression: require() of an ESM graph whose entry point directly imports a
// module that's also reachable through a re-exporting barrel deadlocked (on
// macOS) or tripped `ASSERT(m_status == Status::Fetching)` in
// ModuleRegistryEntry::fetchComplete (on Linux debug). Root cause was the
// JSC module-loader rewrite: when `hostLoadImportedModule`'s synchronous
// re-entry path force-fulfilled a diamond-shared module's fetchPromise and
// called `fetchComplete` inline, the queued `moduleRegistryModuleSettled`
// microtask still ran later and called `fetchComplete` a second time on the
// already-Fetched entry.
test("require() of ESM with diamond dependency through barrel does not deadlock", async () => {
  using dir = tempDir("issue-30493", {
    "shared.js": `import path from 'path';\nexport const SHARED = path.sep;\n`,
    "barrel.js": `import { SHARED } from './shared.js';\nexport { SHARED };\nexport const BARREL = 'barrel';\n`,
    "a.js": `import { SHARED } from './barrel.js';\nexport default function a() { return SHARED; }\n`,
    "b.js": `import { BARREL } from './barrel.js';\nexport default function b() { return BARREL; }\n`,
    "app.js": `import a from './a.js';\nimport b from './b.js';\nimport { SHARED } from './shared.js';\nexport default { a: a(), b: b(), shared: SHARED };\n`,
    "entry.js": `const mod = require('./app.js');\nconsole.log(JSON.stringify(mod.default));\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // shared: path.sep on darwin/linux is "/", on windows "\\".
  expect(JSON.parse(stdout.trim())).toEqual({ a: "/", b: "barrel", shared: "/" });
  expect(exitCode).toBe(0);
});
