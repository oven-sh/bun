// Correctness guard for the bun_internal_modules_data blob layout
// (src/codegen/bundle-modules.ts + bundle-functions.ts): the WebCoreJSBuiltins
// function sources sit at offset 0, internal module sources follow at generated
// offsets. A wrong offset or length here surfaces as a SyntaxError when JSC
// parses a module or a @-intrinsic builtin function from the blob.
//
// The blob is also the builtins section that `bun build --compile --bytecode`
// reads out of the executable that the build goes into. Its format version says
// which buns compile those sources.
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

// A debug build of bun is 800 MB. These read the parts of an executable that they need, not the file.
function readAt(fd: number, offset: number, length: number) {
  const bytes = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const count = readSync(fd, bytes, filled, length - filled, offset + filled);
    if (count === 0) break;
    filled += count;
  }
  return bytes.subarray(0, filled);
}
function* placesOf(fd: number, text: string) {
  const chunk = 16 * 1024 * 1024;
  const size = fstatSync(fd).size;
  for (let start = 0; start < size; start += chunk) {
    // Longer than a chunk by what a match across its end needs, so each match is in one chunk only.
    const bytes = readAt(fd, start, chunk + text.length - 1);
    for (let at = bytes.indexOf(text, 0, "latin1"); at !== -1; at = bytes.indexOf(text, at + 1, "latin1")) {
      yield start + at;
    }
  }
}
// The builtins section of a bun executable: where its format version is in the file, and for each internal module its
// id, its source, and where that is in the file.
function builtinsSection(fd: number) {
  for (const at of placesOf(fd, "BUNBLTNS")) {
    const header = readAt(fd, at, 48);
    const field = (i: number) => header.readUInt32LE(8 + i * 4);
    // The magic is also a constant of the code that reads the section. The header is the one followed by its size.
    if (header.length < 48 || field(3) !== 48) continue;
    const [count, modulesOffset, dataOffset, dataLength] = [field(2), field(3), field(6), field(7)];
    const section = readAt(fd, at, dataOffset + dataLength);
    const modules = new Map<string, { id: number; source: string; sourceAt: number }>();
    for (let id = 0; id < count; id++) {
      const record = modulesOffset + id * 24;
      const span = (k: number) => {
        const offset = dataOffset + section.readUInt32LE(record + k * 8);
        return { offset, end: offset + section.readUInt32LE(record + k * 8 + 4) };
      };
      const [name, source] = [span(0), span(2)];
      modules.set(section.toString("latin1", name.offset, name.end), {
        id,
        source: section.toString("latin1", source.offset, source.end),
        sourceAt: at + source.offset,
      });
    }
    return { versionAt: at + 8, modules };
  }
  throw new Error("no builtins section in " + bunExe());
}

// Format 1 is what bun 1.4.1 and 1.4.2 write and read. Their JavaScriptCore writes through a null pointer when it
// compiles a module that uses a private name (`@name`) it does not have, so nothing newer has format 1.
// "--bytecode=cross" in test/bundler/bun-build-compile.test.ts is the other half: a build into an executable with this
// bun's own format version, where more than 10 internal modules load from bytecode.
// (The timeout: the target is a copy of this bun, which is 800 MB for a debug build. 21s under debug+ASAN.)
test("a build into an executable with builtins format 1 compiles none of its modules", async () => {
  using dir = tempDir("builtins-section-format", {
    "app.js": `import os from "node:os";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
// The build has node:punycode in it. Nothing loads it.
if (process.argv.length > 99) require("node:punycode");
console.log(JSON.stringify({ eol: os.EOL, fromBytecode: internalModulesLoadedFromBytecode() }));`,
  });
  const target = join(String(dir), isWindows ? "target.exe" : "target");
  cpSync(bunExe(), target);
  chmodSync(target, 0o755);
  const fd = openSync(target, "r+");
  try {
    const { versionAt, modules } = builtinsSection(fd);
    // A private name that no bun has, in a module that the build compiles if it compiles the section.
    const { source, sourceAt } = modules.get("node:punycode")!;
    const name = "@throwRangeError";
    expect(source).toContain(name);
    writeSync(fd, "@" + Buffer.alloc(name.length - 1, "z").toString(), sourceAt + source.indexOf(name), "latin1");
    const version = Buffer.alloc(4);
    version.writeUInt32LE(1);
    writeSync(fd, version, 0, 4, versionAt);
  } finally {
    closeSync(fd);
  }

  const outfile = join(String(dir), isWindows ? "app.exe" : "app");
  await using build = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--bytecode",
      "--format=esm",
      `--compile-executable-path=${target}`,
      join(String(dir), "app.js"),
      "--outfile",
      outfile,
    ],
    env: bunEnv,
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
}, 120_000);
