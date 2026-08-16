// On Windows, fs.readdir() goes through openDirAtWindowsNtPath which calls
// NtCreateFile. NtCreateFile can return NTSTATUS codes that are not named in
// Zig's (non-exhaustive) NTSTATUS enum — one seen in the wild is
// STATUS_UNTRUSTED_MOUNT_POINT (0xC00004BC) when traversing certain junctions
// under newer Windows 11 security policies.
//
// Previously a debug-logging branch evaluated `@tagName(rc)` on that status.
// `@tagName` on an unnamed tag of a non-exhaustive enum panics with
// "invalid enum value", and because Windows release builds are ReleaseSafe
// (allow_assert = true), that branch was compiled into shipped binaries.
//
// A deterministic unit test would need to force NtCreateFile to return an
// NTSTATUS outside the Zig enum, which depends on OS version and local
// security policy and can't be done portably from userspace. Instead this
// test exercises the same readdir → openDirAtWindowsNtPath path through a
// junction (the reported trigger) and asserts that any failure surfaces as a
// catchable Error rather than terminating the process.
//
// https://github.com/oven-sh/bun/issues/26496
// https://github.com/oven-sh/bun/issues/28721
// https://github.com/oven-sh/bun/issues/29158

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

test.skipIf(!isWindows)("fs.readdir through a junction returns or throws, never panics", async () => {
  using dir = tempDir("readdir-ntstatus", {
    "target/a.txt": "a",
    "target/b.txt": "b",
  });
  const root = String(dir);
  const target = path.join(root, "target");
  const link = path.join(root, "link");

  // Junctions don't require admin rights on Windows.
  fs.symlinkSync(target, link, "junction");

  // Run in a child so that if the old `@tagName(rc)` panic fires, this test
  // observes it as a non-zero exit code instead of bringing down the runner.
  // The child prints JSON describing the outcome on success or caught error.
  const fixture = `
    const fs = require("node:fs");
    const link = process.argv[2];
    let out;
    try {
      const entries = fs.readdirSync(link).sort();
      out = { ok: true, entries };
    } catch (err) {
      out = { ok: false, code: err && err.code, message: String(err && err.message) };
    }
    process.stdout.write(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture, link],
    env: bunEnv,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(() => JSON.parse(stdout)).not.toThrow();

  const result = JSON.parse(stdout) as
    | { ok: true; entries: string[] }
    | { ok: false; code: string | undefined; message: string };

  if (result.ok) {
    expect(result.entries).toEqual(["a.txt", "b.txt"]);
  } else {
    // On hardened Windows configurations the junction may be rejected by
    // NtCreateFile with a status that maps to a real errno; the important
    // thing is that it was catchable in JS.
    expect(typeof result.message).toBe("string");
  }

  expect(exitCode).toBe(0);
});
