import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Node.js tests flagged `// Flags: --expose-internals` do
// `require("internal/errors")` directly. Bun's src/js/internal/* modules are
// bundled into the InternalModuleRegistry and normally only reachable from
// other builtins. When BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING is set (same gate
// as `bun:internal-for-testing`), the module loader should resolve
// `internal/<name>` specifiers against that registry.

test("internal/errors is requireable under the testing flag", async () => {
  // bunEnv already sets BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING + the GC flag
  // that unlocks it; the gate's stash-and-test wrapper will exercise the
  // "module not found" path on a build without the fix.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const e = require("internal/errors");
        const assert = require("assert");

        // Surface area the Node parallel tests depend on.
        assert.strictEqual(typeof e.E, "function");
        assert.strictEqual(typeof e.SystemError, "function");
        assert.strictEqual(typeof e.hideStackFrames, "function");
        assert.strictEqual(typeof e.aggregateTwoErrors, "function");
        assert.strictEqual(typeof e.determineSpecificType, "function");
        assert.strictEqual(typeof e.formatList, "function");
        assert.strictEqual(typeof e.DNSException, "function");
        assert.strictEqual(typeof e.UVException, "function");
        assert.strictEqual(typeof e.UVExceptionWithHostPort, "function");
        assert.strictEqual(typeof e.AbortError, "function");
        assert.strictEqual(typeof e.kIsNodeError, "symbol");
        assert.strictEqual(typeof e.codes, "object");

        // E() registers a code and makeNodeErrorWithCode wires it up.
        e.E("ERR_EXPOSE_INTERNALS_TEST", "hello %s", Error, TypeError);
        const err = new e.codes.ERR_EXPOSE_INTERNALS_TEST("world");
        assert.strictEqual(err.code, "ERR_EXPOSE_INTERNALS_TEST");
        assert.strictEqual(err.message, "hello world");
        assert.ok(err instanceof Error);
        assert.ok(new e.codes.ERR_EXPOSE_INTERNALS_TEST.TypeError("x") instanceof TypeError);

        // SystemError shape.
        e.E("ERR_EXPOSE_INTERNALS_SYS", "sys", e.SystemError);
        const se = new e.codes.ERR_EXPOSE_INTERNALS_SYS({
          code: "ETEST",
          message: "m",
          syscall: "s",
        });
        assert.strictEqual(se.name, "SystemError");
        assert.strictEqual(se.code, "ERR_EXPOSE_INTERNALS_SYS");
        assert.strictEqual(se.syscall, "s");
        assert.strictEqual(se[e.kIsNodeError], true);

        // UVException with an unmapped errno.
        const uv = new e.UVException({ errno: 100, syscall: "open" });
        assert.strictEqual(uv.code, "UNKNOWN");
        assert.strictEqual(uv.errno, 100);

        // formatList / determineSpecificType.
        assert.strictEqual(e.formatList(["a", "b"]), "a and b");
        assert.strictEqual(e.determineSpecificType(null), "null");

        // Other internal/* modules route through the same mechanism.
        assert.strictEqual(typeof require("internal/validators").validateInteger, "function");
        assert.strictEqual(typeof require("internal/test/binding").internalBinding, "function");
        assert.strictEqual(typeof require("internal/util/inspect").inspect, "function");

        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("internal/errors is importable (ESM) under the testing flag", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--input-type=module",
      "-e",
      `
        import errors from "internal/errors";
        if (typeof errors.determineSpecificType !== "function") throw new Error("missing");
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("process.config.variables.v8_enable_i18n_support is set (was misspelled 'i8n')", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log(process.config.variables.v8_enable_i18n_support)`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  expect(stdout.trim()).toBe("1");
  expect(exitCode).toBe(0);
});
