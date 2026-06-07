import { describe, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import assert from "node:assert";
import path from "node:path";

describe("path", () => {
  test("errors", () => {
    // Test thrown TypeErrors
    const typeErrorTests = [true, false, 7, null, {}, undefined, [], NaN];

    function fail(fn) {
      const args = Array.from(arguments).slice(1);

      assert.throws(
        () => {
          fn.apply(null, args);
        },
        { code: "ERR_INVALID_ARG_TYPE", name: "TypeError" },
      );
    }

    for (const test of typeErrorTests) {
      for (const namespace of [path.posix, path.win32]) {
        fail(namespace.join, test);
        fail(namespace.resolve, test);
        fail(namespace.normalize, test);
        fail(namespace.isAbsolute, test);
        fail(namespace.relative, test, "foo");
        fail(namespace.relative, "foo", test);
        fail(namespace.parse, test);
        fail(namespace.dirname, test);
        fail(namespace.basename, test);
        fail(namespace.extname, test);

        // Undefined is a valid value as the second argument to basename
        if (test !== undefined) {
          fail(namespace.basename, "foo", test);
        }
      }
    }
  });

  test("path.sep", () => {
    // path.sep tests
    // windows
    assert.strictEqual(path.win32.sep, "\\");
    // posix
    assert.strictEqual(path.posix.sep, "/");
  });

  test("path.delimiter", () => {
    // path.delimiter tests
    // windows
    assert.strictEqual(path.win32.delimiter, ";");
    // posix
    assert.strictEqual(path.posix.delimiter, ":");

    if (isWindows) assert.strictEqual(path, path.win32);
    else assert.strictEqual(path, path.posix);
  });
});

test.if(isWindows)("Bun.which skips PATH segments longer than the Windows wide-path buffer", async () => {
  // A single PATH segment longer than the fixed 32767-element wide-character
  // path buffer must be skipped instead of being transcoded into it, and the
  // remaining segments must still be searched. Run in a subprocess so the
  // assertion is on the child's output and exit code.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
const dir = path.dirname(process.execPath);
const name = path.basename(process.execPath, ".exe");
const oversized = Buffer.alloc(70000, "a").toString();
console.log(Bun.which(name, { PATH: oversized }));
const found = Bun.which(name, { PATH: oversized + ";" + dir });
console.log(found !== null && path.basename(found).toLowerCase() === (name + ".exe").toLowerCase());`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  assert.strictEqual(stdout.split(/\r?\n/).filter(Boolean).join("\n"), "null\ntrue");
  assert.strictEqual(exitCode, 0);
});
