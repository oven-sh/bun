// Correctness guard for the bun_internal_modules_data blob layout
// (src/codegen/bundle-modules.ts + bundle-functions.ts): the WebCoreJSBuiltins
// function sources sit at offset 0, internal module sources follow at generated
// offsets. A wrong offset or length here surfaces as a SyntaxError when JSC
// parses a module or a @-intrinsic builtin function from the blob.
//
// The blob is also the builtins section that `bun build --compile --bytecode`
// reads out of the executable that the build goes into. Its header says which
// buns compile those sources.
import * as internalForTesting from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
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
// The builtins section of a bun executable: its format version and its engine stamp, where they are in the file, and
// for each internal module its id, its source, and where that is in the file.
function builtinsSection(fd: number) {
  for (const at of placesOf(fd, "BUNBLTNS")) {
    const header = readAt(fd, at, 48);
    const field = (i: number) => header.readUInt32LE(8 + i * 4);
    // The magic is also a constant of the code that reads the section. The header is the one followed by its size.
    if (header.length < 48 || field(3) !== 48) continue;
    return {
      version: field(0),
      versionAt: at + 8,
      engineStamp: field(8),
      engineStampAt: at + 40,
      modules() {
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
        return modules;
      },
    };
  }
  throw new Error("no builtins section in " + bunExe());
}

// This bun compiles the internal modules of another executable with its own JavaScriptCore. It must not compile
// sources that are for another JavaScriptCore or for other private names (`@name`): a name that JavaScriptCore does
// not have is a write through a null pointer there. Two header words say whether a section is for this bun:
// - the format version. bun 1.4.1 to 1.4.3 write and read 1, and they have no other check, so nothing newer has 1.
// - the engine stamp: the WebKit version and the private names of the bun that wrote the section.
// "--bytecode=cross" in test/bundler/bun-build-compile.test.ts is the other half: a build into a copy of this bun as
// it is, where more than 10 internal modules load from bytecode.
// (The timeout: the target is a copy of this bun, which is 800 MB for a debug build. 35s under debug+ASAN.)
test("a build compiles none of the modules of a builtins section that is not for this bun", async () => {
  using dir = tempDir("builtins-section-not-for-this-bun", {
    "app.js": `import os from "node:os";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
// The build has node:punycode in it. Nothing loads it.
if (process.argv.length > 99) require("node:punycode");
console.log(JSON.stringify({ eol: os.EOL, fromBytecode: internalModulesLoadedFromBytecode() }));`,
    // A build says why it has no bytecode for builtin modules at this level only.
    "bunfig.toml": `logLevel = "debug"\n`,
  });
  const target = join(String(dir), isWindows ? "target.exe" : "target");
  cpSync(bunExe(), target);
  chmodSync(target, 0o755);
  // Not open while a build reads the target.
  const edit = <T>(change: (fd: number) => T) => {
    const fd = openSync(target, "r+");
    try {
      return change(fd);
    } finally {
      closeSync(fd);
    }
  };
  const word = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
  };

  const { versionAt, engineStampAt, version, engineStamp } = edit(fd => {
    const section = builtinsSection(fd);
    // A private name that no bun has, in a module that the build compiles if it compiles the section.
    const { source, sourceAt } = section.modules().get("node:punycode")!;
    const name = "@throwRangeError";
    expect(source).toContain(name);
    writeSync(fd, "@" + Buffer.alloc(name.length - 1, "z").toString(), sourceAt + source.indexOf(name), "latin1");
    return section;
  });

  for (const [section, at, value, why] of [
    [
      "format version 1",
      versionAt,
      1,
      `the target executable has builtins format 1, and this bun compiles format ${version}`,
    ],
    [
      "another engine stamp",
      engineStampAt,
      (engineStamp ^ 1) >>> 0,
      "the target executable has another JavaScriptCore or other private names than this bun",
    ],
  ] as const) {
    const original = edit(fd => {
      const original = readAt(fd, at, 4);
      writeSync(fd, word(value), 0, 4, at);
      return original;
    });

    const name = section.replaceAll(" ", "-");
    const outfile = join(String(dir), isWindows ? name + ".exe" : name);
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
    expect({
      section,
      noBytecode: buildStderr.split(/\r?\n/).filter(line => line.includes("No bytecode for builtin modules")),
      stderr: buildExitCode === 0 ? "" : buildStderr,
      exitCode: buildExitCode,
    }).toEqual({
      section,
      noBytecode: [`debug: No bytecode for builtin modules: ${why}`],
      stderr: "",
      exitCode: 0,
    });

    await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ section, stdout: stdout.trim(), stderr, exitCode }).toEqual({
      section,
      stdout: JSON.stringify({ eol: isWindows ? "\r\n" : "\n", fromBytecode: 0 }),
      stderr: "",
      exitCode: 0,
    });

    edit(fd => writeSync(fd, original, 0, 4, at));
  }
}, 120_000);

// The stamp is worth something only if it follows the engine. This is what it is made of, asked of this bun and not
// of the code that wrote the stamp. One commit has the same WebKit version and the same names on every platform.
test("the engine stamp of the builtins section is the WebKit version and the private names of this bun", () => {
  const hash = createHash("sha256");
  for (const part of [process.versions.webkit, ...internalForTesting.builtinPrivateNames().sort()]) {
    hash.update(part + "\n");
  }
  const fd = openSync(bunExe(), "r");
  try {
    // 0 is a section without a stamp.
    expect(builtinsSection(fd).engineStamp).toBe(hash.digest().readUInt32BE(0) || 1);
  } finally {
    closeSync(fd);
  }
});
