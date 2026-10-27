// Correctness guard for the bun_internal_modules_data blob layout
// (src/codegen/bundle-modules.ts + bundle-functions.ts): the WebCoreJSBuiltins
// function sources sit at offset 0, internal module sources follow at generated
// offsets. A wrong offset or length here surfaces as a SyntaxError when JSC
// parses a module or a @-intrinsic builtin function from the blob.
// The last block guards the names bundle-functions.ts gives the builtin functions.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, closeSync, cpSync, fstatSync, openSync, readSync, writeSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";
import { inspect } from "node:util";

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

// bundle-functions.ts also names each builtin function. JSC takes `fn.name`,
// Function.prototype.toString() and the stack frame name of a builtin from the
// name its executable is created with, not from the property that holds it. So
// the rows below cover each way the C++ side attaches a builtin.
describe("functions implemented in src/js/builtins", () => {
  test("are named after the export", () => {
    expect({
      // A HashTableValue row of type BuiltinGeneratorType (JSBuffer.cpp)
      "Buffer.prototype.toJSON": Buffer.prototype.toJSON.name,
      // JSBuiltin rows of a .lut.h table (JSBuffer.cpp, NodeModuleModule.cpp)
      "Buffer.from": Buffer.from.name,
      "Buffer.isBuffer": Buffer.isBuffer.name,
      "Module._initPaths": Module._initPaths.name,
      // `builtin: true` in a .bind.ts class (Glob.bind.ts)
      "Glob.prototype.scan": Bun.Glob.prototype.scan.name,
      "Glob.prototype.scanSync": Bun.Glob.prototype.scanSync.name,
      // JSFunction::create(vm, global, <name>CodeGenerator(vm), ...) (BunObject.cpp, BunProcess.cpp)
      "Bun.peek": Bun.peek.name,
      "process.loadEnvFile": process.loadEnvFile.name,
      // putDirectBuiltinFunction (ZigGlobalObject.cpp)
      "console.write": console.write.name,
    }).toEqual({
      "Buffer.prototype.toJSON": "toJSON",
      "Buffer.from": "from",
      "Buffer.isBuffer": "isBuffer",
      "Module._initPaths": "_initPaths",
      "Glob.prototype.scan": "scan",
      "Glob.prototype.scanSync": "scanSync",
      "Bun.peek": "peek",
      "process.loadEnvFile": "loadEnvFile",
      "console.write": "write",
    });
  });

  test("use $overriddenName when the exposed key differs from the export", () => {
    // UtilInspect.ts stylizeWithNoColor is the `stylize` Bun.inspect hands to inspect.custom.
    let stylizeName: string | undefined;
    Bun.inspect({
      [inspect.custom](_depth: number, options: { stylize: Function }) {
        stylizeName = options.stylize.name;
        return "";
      },
    });

    expect({
      "Bun.inspect stylize": stylizeName,
      // Peek.ts peekStatus
      "Bun.peek.status": Bun.peek.status.name,
      // ProcessObjectInternals.ts rawDebug
      "process._rawDebug": process._rawDebug.name,
      // CommonJS.ts overridableRequire
      "Module.prototype.require": Module.prototype.require.name,
      // CommonJS.ts requireResolve. `require.resolve` itself is a bound function that
      // JSCommonJSModule.cpp names "resolve", so its name is "bound resolve" either way.
      "Object.getPrototypeOf(require).resolve": Object.getPrototypeOf(require).resolve.name,
      // ConsoleObject.ts asyncIterator
      "console[Symbol.asyncIterator]": console[Symbol.asyncIterator].name,
      // JSBufferPrototype.ts offset, a $getter
      "get Buffer.prototype.offset": Object.getOwnPropertyDescriptor(Buffer.prototype, "offset")!.get!.name,
    }).toEqual({
      "Bun.inspect stylize": "stylizeNoColor",
      "Bun.peek.status": "status",
      "process._rawDebug": "_rawDebug",
      "Module.prototype.require": "require",
      "Object.getPrototypeOf(require).resolve": "resolve",
      "console[Symbol.asyncIterator]": "[Symbol.asyncIterator]",
      "get Buffer.prototype.offset": "get offset",
    });
  });

  test("carry the name into the descriptor, toString(), inspect, bind and stack frames", () => {
    // Buffer.from rejects a number from inside the builtin, so its frame is in the stack.
    let error: Error | undefined;
    try {
      Buffer.from(1 as unknown as string);
    } catch (e) {
      error = e as Error;
    }

    expect({
      descriptor: Object.getOwnPropertyDescriptor(Buffer.from, "name"),
      toString: Buffer.from.toString(),
      inspect: Bun.inspect(Bun.Glob.prototype.scanSync),
      bound: Buffer.from.bind(null).name,
      frame: error!.stack!.includes("at from ("),
    }).toEqual({
      descriptor: { value: "from", writable: false, enumerable: false, configurable: true },
      toString: "function from() { [native code] }",
      inspect: "[Function: scanSync]",
      bound: "bound from",
      frame: true,
    });
  });

  // A builtin gets its name when its executable is first created, once per VM.
  test("are named in the VM of a Worker", async () => {
    const url = URL.createObjectURL(
      new Blob([`postMessage([Buffer.from.name, Bun.peek.name, Bun.peek.status.name, console.write.name]);`]),
    );
    const worker = new Worker(url);
    try {
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      worker.onmessage = event => resolve(event.data);
      worker.onerror = reject;
      worker.addEventListener("close", event => reject(new Error(`worker closed (${event.code}) without a message`)));
      expect(await promise).toEqual(["from", "peek", "status", "write"]);
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });
});
