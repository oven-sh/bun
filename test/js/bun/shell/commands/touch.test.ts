import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

$.nothrow();

const ENOENT = "touch: No such file or directory\n";
const past = new Date("2000-01-01T00:00:00Z");

describe.concurrent("bunshell touch", () => {
  // An empty operand used to be joined onto the shell's cwd, which resolved to
  // the cwd itself: `touch ""` exited 0 and bumped the cwd's timestamps.
  test('touch "" fails and leaves the cwd untouched', async () => {
    using dir = tempDir("touch-empty", {});
    const cwd = String(dir);
    utimesSync(cwd, past, past);

    const { stdout, stderr, exitCode } = await $`touch ""`.cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(statSync(cwd).mtimeMs).toBe(past.getTime());
  });

  test('touch ${""} fails and leaves the cwd untouched', async () => {
    using dir = tempDir("touch-empty-interp", {});
    const cwd = String(dir);
    utimesSync(cwd, past, past);

    const { stdout, stderr, exitCode } = await $`touch ${""}`.cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(statSync(cwd).mtimeMs).toBe(past.getTime());
  });

  test("the other operands are still touched when one is empty", async () => {
    using dir = tempDir("touch-empty-multi", { existing: "" });
    const cwd = String(dir);
    utimesSync(join(cwd, "existing"), past, past);

    const { stdout, stderr, exitCode } = await $`touch created "" existing`.cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(existsSync(join(cwd, "created"))).toBeTrue();
    expect(statSync(join(cwd, "existing")).mtimeMs).toBeGreaterThan(past.getTime());
  });
});
