// Correctness guard for the bun_internal_modules_data blob layout
// (src/codegen/bundle-modules.ts + bundle-functions.ts): the WebCoreJSBuiltins
// function sources sit at offset 0, internal module sources follow at generated
// offsets. A wrong offset or length here surfaces as a SyntaxError when JSC
// parses a module or a @-intrinsic builtin function from the blob.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { sliceSourceCode } from "../../src/codegen/builtin-parser";

test("internal JS builtin function and module sources parse from the linked blob", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // WebCoreJSBuiltins path: ReadableStream's reader/pipe machinery is all @-intrinsic
        // builtin functions whose source sits at the start of the blob.
        const { readable, writable } = new TransformStream({ transform: (c, ctl) => ctl.enqueue(c) });
        const w = writable.getWriter();
        w.write("blob-ok");
        w.close();
        const [r] = await Promise.all([readable.getReader().read()]);

        // InternalModuleRegistry path: each module's source is a span at a known
        // offset into the same blob (release) or read from disk (debug).
        const assert = require("node:assert");
        assert.strictEqual(require("node:util").format("%s", r.value), "blob-ok");
        assert.strictEqual(require("node:path").posix.join("a", "b"), "a/b");
        require("node:stream");
        require("node:http");

        console.log(r.value);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "blob-ok", stderr: "", exitCode: 0 });
});

// $getByIdDirectPrivate and $putByIdDirectPrivate take a private name as a string. JavaScriptCore looks it up when it
// compiles the function that has the call, and a name it does not have is a SyntaxError at the first call of that
// function. The codegen that bundles src/js stops the build for such a name.
test("the private name that an intrinsic takes as a string is a row of BunBuiltinNames.h", () => {
  const source = `{ $putByIdDirectPrivate(stream, "bunNativePtr", f(a, [b, c])); return $getByIdDirectPrivate(this, 'writer'); }`;
  expect(sliceSourceCode(source, true).result).toBe(
    `{ __intrinsic__putByIdDirectPrivate(stream, "bunNativePtr", f(a, [b, c])); return __intrinsic__getByIdDirectPrivate(this, 'writer'); }`,
  );
  expect(() => sliceSourceCode(`{ return $getByIdDirectPrivate(f(a, b), "writerr"); }`, true)).toThrow(
    `"writerr" is not a private name in src/js/builtins/BunBuiltinNames.h`,
  );
  expect(() => sliceSourceCode(`{ $putByIdDirectPrivate(this, name, 1); }`, true)).toThrow(
    "$putByIdDirectPrivate takes a private name as a string literal",
  );
});
