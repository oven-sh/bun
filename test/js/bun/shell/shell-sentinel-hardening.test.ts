import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("shell sentinel character hardening", () => {
  test("string matching internal obj-ref prefix round-trips through interpolation", async () => {
    // \x08 is the shell's internal sentinel byte. When followed by "__bun_"
    // and then non-digit characters, the old code didn't escape \x08 (it wasn't
    // in SPECIAL_CHARS), so the raw bytes were injected into the script buffer.
    // The lexer then misinterpreted them as a malformed internal object
    // reference pattern and produced a lex error.
    // The suffix must contain non-digit, non-special chars so that:
    //   1. needsEscape() returns false without the \x08 fix
    //   2. looksLikeJSObjRef() matches the __bun_ prefix
    //   3. eatJSObjRef() fails because it finds no digit index
    const str = "\x08__bun_abc";
    const result = await $`echo ${str}`.text();
    expect(result).toBe(str + "\n");
  });

  test("string matching internal str-ref prefix round-trips through interpolation", async () => {
    // Same issue but for the __bunstr_ prefix pattern.
    const str = "\x08__bunstr_abc";
    const result = await $`echo ${str}`.text();
    expect(result).toBe(str + "\n");
  });

  test("raw sentinel injection with out-of-bounds index does not crash", async () => {
    // { raw: ... } bypasses string escaping, allowing injection of a sentinel
    // pattern with a digit suffix into the script buffer. The old
    // validateJSObjRefIdx only rejected indices >= maxInt(u32), so index 9999
    // was accepted. At execution time, accessing jsobjs[9999] on an empty
    // array caused a segfault. The fix checks against actual jsobjs.len.
    // Run in a subprocess so a crash on old bun doesn't kill the test runner.
    const testScript = [
      'import { $ } from "bun";',
      "const sentinel = String.fromCharCode(8) + '__bun_9999';",
      "try { await $`echo hello > ${{ raw: sentinel }}`; } catch {}",
      'console.log("OK");',
    ].join("\n");

    using dir = tempDir("sentinel-test", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});
