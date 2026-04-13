// https://github.com/oven-sh/bun/issues/29244
//
// os.homedir() returned a stale value after process.env.HOME was mutated
// at runtime. Bun's env-var cache snapshots HOME on first read, so
// os.homedir() never saw subsequent changes — even mutations made before
// require('node:os').
//
// Node's posix uv_os_homedir checks HOME live on every call, falling back
// to the passwd entry only when HOME is empty/unset. os.userInfo().homedir
// reads passwd directly and does NOT honor HOME in Node — that behavior
// must be preserved.
//
// Run in a subprocess: mutating process.env.HOME in-process would affect
// the test runner's own state.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

async function runBun(source: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: { ...bunEnv, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // ASAN builds unconditionally print "WARNING: ASAN interferes with JSC
  // signal handlers..." to stderr from WebKit's Options.cpp; filter it out.
  const stderrFiltered = stderr
    .split(/\r?\n/)
    .filter(s => !s.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  return { stdout, stderr: stderrFiltered, exitCode };
}

test.skipIf(isWindows)("os.homedir() reflects HOME mutation after require (#29244)", async () => {
  const { stdout, stderr, exitCode } = await runBun(`
    const os = require('node:os');
    const before = os.homedir();
    process.env.HOME = '/tmp/test-home-29244';
    const after = os.homedir();
    console.log(JSON.stringify({ before, after, env: process.env.HOME }));
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.after).toBe("/tmp/test-home-29244");
  expect(result.env).toBe("/tmp/test-home-29244");
  // Baseline came from the inherited HOME — non-empty, not the mutated value.
  expect(typeof result.before).toBe("string");
  expect(result.before.length).toBeGreaterThan(0);
  expect(result.before).not.toBe("/tmp/test-home-29244");
});

test.skipIf(isWindows)("os.homedir() reflects HOME mutation before require (#29244)", async () => {
  const { stdout, stderr, exitCode } = await runBun(`
    process.env.HOME = '/tmp/before-require-29244';
    const os = require('node:os');
    console.log(JSON.stringify({ homedir: os.homedir(), env: process.env.HOME }));
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    homedir: "/tmp/before-require-29244",
    env: "/tmp/before-require-29244",
  });
});

test.skipIf(isWindows)("os.homedir() honors HOME from parent env (#29244)", async () => {
  const { stdout, stderr, exitCode } = await runBun(`console.log(require('node:os').homedir());`, {
    HOME: "/tmp/inherited-29244",
  });
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("/tmp/inherited-29244");
});

test.skipIf(isWindows)("os.homedir() falls back to passwd when HOME is empty (#29244)", async () => {
  // An empty HOME should be treated as unset — fall through to the
  // passwd entry, matching libuv's uv_os_homedir. The fallback must
  // return a non-empty absolute path, not "".
  const { stdout, stderr, exitCode } = await runBun(
    `
        process.env.HOME = '';
        const os = require('node:os');
        const h = os.homedir();
        console.log(JSON.stringify({ h, len: h.length, abs: h.startsWith('/') }));
      `,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.len).toBeGreaterThan(0);
  expect(result.abs).toBe(true);
  expect(result.h).not.toBe("");
});

test.skipIf(isWindows)("os.userInfo().homedir ignores HOME mutation (#29244)", async () => {
  // Node's os.userInfo().homedir reads the passwd entry, NOT $HOME.
  // The fix for os.homedir() must NOT leak into userInfo.
  const { stdout, stderr, exitCode } = await runBun(`
      process.env.HOME = '/tmp/should-not-appear-29244';
      const os = require('node:os');
      const passwd = os.userInfo().homedir;
      console.log(JSON.stringify({ passwd, leaked: passwd === '/tmp/should-not-appear-29244' }));
    `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.leaked).toBe(false);
  expect(typeof result.passwd).toBe("string");
  expect(result.passwd.length).toBeGreaterThan(0);
});
