/**
 * All tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * Regression coverage for https://github.com/oven-sh/bun/issues/31767:
 * spawnSync's result object must match Node's shape on the spawn-failure
 * path (the child never started) as well as the normal process-ran path.
 */

import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { getSystemErrorName } from "node:util";

test("spawnSync(nonexistent) reports the ENOENT 'never started' shape", () => {
  const r = spawnSync("spawnsync-does-not-exist", ["arg0", "arg1"]);

  // The error describes the failed spawn.
  assert.strictEqual(r.error.code, "ENOENT");
  // errno is the libuv-negated value, which differs by platform (-2 on POSIX,
  // -4058 on Windows), so compare by name like Node's own spawnsync test does.
  assert.strictEqual(getSystemErrorName(r.error.errno), "ENOENT");
  assert.strictEqual(r.error.syscall, "spawnSync spawnsync-does-not-exist");
  assert.strictEqual(r.error.path, "spawnsync-does-not-exist");
  assert.deepStrictEqual(r.error.spawnargs, ["arg0", "arg1"]);

  // Because the child never started, the rest of the result is the
  // "never started" shape: no status/signal/output, pid 0, and stdout/stderr
  // are left undefined (not null).
  assert.strictEqual(r.status, null);
  assert.strictEqual(r.signal, null);
  assert.strictEqual(r.output, null);
  assert.strictEqual(r.pid, 0);
  assert.strictEqual(r.stdout, undefined);
  assert.strictEqual(r.stderr, undefined);
});

test("spawnSync(success) keeps the process-ran shape", () => {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write('ok')"]);

  // The child ran to completion: real pid/output/stdout/stderr, no error.
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.signal, null);
  assert.ok(typeof r.pid === "number" && r.pid > 0);
  assert.strictEqual(r.output.length, 3);
  assert.strictEqual(r.output[0], null);
  assert.ok(Buffer.isBuffer(r.stdout));
  assert.ok(Buffer.isBuffer(r.stderr));
  assert.strictEqual(r.stdout.toString(), "ok");
  // stdout/stderr alias output[1]/output[2].
  assert.strictEqual(r.output[1], r.stdout);
  assert.strictEqual(r.output[2], r.stderr);
});
