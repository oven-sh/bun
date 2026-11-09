// Correctness guard for the bun_internal_modules_data blob layout
// (src/codegen/bundle-modules.ts + bundle-functions.ts): the WebCoreJSBuiltins
// function sources sit at offset 0, internal module sources follow at generated
// offsets. A wrong offset or length here surfaces as a SyntaxError when JSC
// parses a module or a @-intrinsic builtin function from the blob.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, closeSync, cpSync, fstatSync, openSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

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

// Returns the builtins section header's offset in a bun executable. Reads in chunks because a debug build is 800 MB.
function findBuiltinsHeader(fd: number) {
  const magic = "BUNBLTNS";
  const chunk = Buffer.alloc(16 * 1024 * 1024 + 48);
  const size = fstatSync(fd).size;
  for (let start = 0; start < size; start += chunk.length - 48) {
    const bytes = chunk.subarray(0, readSync(fd, chunk, 0, chunk.length, start));
    for (let at = bytes.indexOf(magic); at !== -1 && at + 48 <= bytes.length; at = bytes.indexOf(magic, at + 1)) {
      // The magic also appears as a constant in the code that reads the section, so check the header's modulesOffset.
      if (bytes.readUInt32LE(at + 20) === 48) return start + at;
    }
  }
  throw new Error("no builtins section in " + bunExe());
}

// JavaScriptCore crashes on a private name (`@name`) that it doesn't define.
test("--compile --bytecode skips internal modules when the target has a different engine stamp", async () => {
  using dir = tempDir("builtins-engine-stamp", {
    "app.js": `import os from "node:os";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
console.log(JSON.stringify({ eol: os.EOL, fromBytecode: internalModulesLoadedFromBytecode() }));`,
  });
  const target = join(String(dir), isWindows ? "target.exe" : "target");
  cpSync(bunExe(), target);
  chmodSync(target, 0o755);
  const fd = openSync(target, "r+");
  try {
    const engineStampAt = findBuiltinsHeader(fd) + 40;
    const stamp = Buffer.alloc(4);
    readSync(fd, stamp, 0, 4, engineStampAt);
    stamp[0] ^= 1;
    writeSync(fd, stamp, 0, 4, engineStampAt);
  } finally {
    closeSync(fd);
  }

  const outfile = join(String(dir), isWindows ? "out.exe" : "out");
  await using build = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--bytecode",
      "--format=esm",
      `--compile-executable-path=${target}`,
      "app.js",
      "--outfile",
      outfile,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect({ stderr: buildExitCode === 0 ? "" : buildStderr, exitCode: buildExitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });

  await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ eol: isWindows ? "\r\n" : "\n", fromBytecode: 0 }),
    stderr: "",
    exitCode: 0,
  });
}, 60_000);
