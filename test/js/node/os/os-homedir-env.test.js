// https://github.com/oven-sh/bun/issues/29244
// os.homedir() must reflect live process.env.HOME (HOME="" → ""; only absent
// HOME falls through to passwd); os.userInfo().homedir must NOT honor HOME.
// Uses node:test so the same file runs under Node.js to verify parity:
//   node test/js/node/os/os-homedir-env.test.js
// Each check spawns process.execPath so HOME mutations can't leak out.
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const isWindows = process.platform === "win32";

function runWithEnv(source, envOverride = {}) {
  // No harness import (the file must run under plain node), so set the
  // quiet-log vars bunEnv would provide; node ignores them.
  const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
  for (const [key, value] of Object.entries(envOverride)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const { stdout, stderr, status } = spawnSync(process.execPath, ["-e", source], {
    env,
    encoding: "utf8",
  });
  assert.strictEqual(status, 0, stderr);
  return JSON.parse(stdout);
}

test("homedir() reflects HOME mutation after require", { skip: isWindows }, () => {
  const result = runWithEnv(`
    const os = require("node:os");
    const before = os.homedir();
    process.env.HOME = "/tmp/test-home-29244";
    console.log(JSON.stringify({ before, after: os.homedir() }));
  `);
  assert.strictEqual(result.after, "/tmp/test-home-29244");
  assert.notStrictEqual(result.before, "/tmp/test-home-29244");
  assert.ok(result.before.length > 0);
});

test("homedir() reflects HOME mutation before require", { skip: isWindows }, () => {
  const result = runWithEnv(`
    process.env.HOME = "/tmp/before-require-29244";
    console.log(JSON.stringify(require("node:os").homedir()));
  `);
  assert.strictEqual(result, "/tmp/before-require-29244");
});

test("homedir() honors HOME from parent env", { skip: isWindows }, () => {
  const result = runWithEnv(`console.log(JSON.stringify(require("node:os").homedir()));`, {
    HOME: "/tmp/inherited-29244",
  });
  assert.strictEqual(result, "/tmp/inherited-29244");
});

test("homedir() returns '' when HOME is set to empty string", { skip: isWindows }, () => {
  // uv_os_homedir returns getenv("HOME") verbatim whenever it is non-NULL,
  // including ""; only an absent HOME falls through to the passwd entry.
  const result = runWithEnv(`
    process.env.HOME = "";
    console.log(JSON.stringify(require("node:os").homedir()));
  `);
  assert.strictEqual(result, "");
});

test("homedir() falls back to passwd when HOME is deleted", { skip: isWindows }, () => {
  // Seed a sentinel so a silently-ignored delete is detectable, and
  // cross-check against userInfo().homedir (the passwd entry).
  const sentinel = "/tmp/sentinel-deleted-29244";
  const result = runWithEnv(
    `
      delete process.env.HOME;
      const os = require("node:os");
      console.log(JSON.stringify({ h: os.homedir(), passwd: os.userInfo().homedir }));
    `,
    { HOME: sentinel },
  );
  assert.notStrictEqual(result.h, sentinel);
  assert.strictEqual(result.h, result.passwd);
  assert.ok(result.h.startsWith("/"));
});

test("userInfo().homedir ignores HOME mutation", { skip: isWindows }, () => {
  const result = runWithEnv(`
    process.env.HOME = "/tmp/should-not-appear-29244";
    console.log(JSON.stringify(require("node:os").userInfo().homedir));
  `);
  assert.notStrictEqual(result, "/tmp/should-not-appear-29244");
  assert.ok(result.length > 0);
});
