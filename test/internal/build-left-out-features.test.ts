/**
 * Build options that leave a feature out of Bun: what each one passes to the compilers, and what a Bun that was built
 * with it lacks. The second half runs against such a Bun only.
 */
import { JSCallback } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { webkit } from "../../scripts/build/deps/webkit.ts";
import { computeFlags } from "../../scripts/build/flags.ts";
import { findImage, imageFlag, imageHeader } from "../aot/cli/compiled-image";
import { unsupported } from "../aot/harness/compiler";

function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLlvmVersion: "23.1.1",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    readobj: "/fake/llvm/bin/llvm-readobj",
    objdump: "/fake/llvm/bin/llvm-objdump",
    cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: undefined,
    nasm: undefined,
  };
}

function config(partial: PartialConfig, buildDir: string): Config {
  return resolveConfig(
    {
      os: "linux",
      arch: "x64",
      abi: "gnu",
      buildType: "Release",
      webkit: "local",
      buildDir,
      linuxSysroot: buildDir,
      ...partial,
    },
    mockToolchain(),
  );
}

async function run(source: string, env: Record<string, string> = {}) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

test("--shadow-realm=off defines BUN_DISABLE_SHADOW_REALM, and nothing else does", () => {
  using dir = tempDir("build-left-out-features", {});
  const define = "BUN_DISABLE_SHADOW_REALM=1";
  expect(computeFlags(config({ shadowRealm: false }, String(dir))).defines).toContain(define);
  expect(computeFlags(config({}, String(dir))).defines).not.toContain(define);
  expect(computeFlags(config({ shadowRealm: true, webAssembly: false }, String(dir))).defines).not.toContain(define);
});

test("--ffi=off defines BUN_DISABLE_FFI, and nothing else does", () => {
  using dir = tempDir("build-left-out-features", {});
  const define = "BUN_DISABLE_FFI=1";
  expect(computeFlags(config({ ffi: false }, String(dir))).defines).toContain(define);
  expect(computeFlags(config({}, String(dir))).defines).not.toContain(define);
  expect(computeFlags(config({ ffi: true, shadowRealm: false }, String(dir))).defines).not.toContain(define);
});

test("--web-assembly=off takes a WebKit compiled without WebAssembly: a local one, or the one such prebuilt", () => {
  using dir = tempDir("build-left-out-features", {});
  const url = (partial: PartialConfig) => {
    const source = webkit.source(config({ webkit: "prebuilt", ...partial }, String(dir)));
    return source.kind === "prebuilt" ? source.url.slice(source.url.lastIndexOf("/") + 1) : source.kind;
  };
  const hardened = { hardened: true, lto: true, aot: true };
  expect(url(hardened)).toBe("bun-webkit-linux-amd64-lto-hardened-aot.tar.gz");
  expect(url({ ...hardened, webAssembly: false })).toBe(
    "bun-webkit-linux-amd64-lto-hardened-aot-no-webassembly.tar.gz",
  );
  expect(config({ webAssembly: false }, String(dir)).webAssembly).toBe(false);
  for (const partial of [{}, { hardened: true, lto: false }, { hardened: true, lto: true, aot: false }, { lto: true }])
    expect(() => config({ webkit: "prebuilt", webAssembly: false, ...partial }, String(dir))).toThrow(
      "webAssembly=false requires hardened=true, lto=true and aot=true, or webkit=local",
    );
});

const hasShadowRealm = typeof ShadowRealm !== "undefined";

describe.skipIf(hasShadowRealm)("a Bun built with --shadow-realm=off", () => {
  test("has no ShadowRealm global", async () => {
    const source = `
      let thrown;
      try { new ShadowRealm(); } catch (error) { thrown = error; }
      console.log(typeof ShadowRealm, "ShadowRealm" in globalThis, thrown instanceof ReferenceError, thrown.message);
    `;
    expect(await run(source)).toEqual({
      stdout: "undefined false true ShadowRealm is not defined",
      stderr: "",
      exitCode: 0,
    });
  });

  test("BUN_JSC_useShadowRealm=1 does not bring it back", async () => {
    expect(await run("console.log(typeof ShadowRealm)", { BUN_JSC_useShadowRealm: "1" })).toEqual({
      stdout: "undefined",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a program may define the name", async () => {
    expect(await run("globalThis.ShadowRealm = class {}; console.log(typeof new ShadowRealm())")).toEqual({
      stdout: "object",
      stderr: "",
      exitCode: 0,
    });
  });
});

test.skipIf(!hasShadowRealm)("a Bun built without the option has ShadowRealm", async () => {
  expect(await run("console.log(new ShadowRealm().evaluate('1 + 1'))")).toEqual({
    stdout: "2",
    stderr: "",
    exitCode: 0,
  });
});

const refusal = "bun:ffi: this build of Bun does not call native functions";
const compiler = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

function callsNativeFunctions() {
  try {
    new JSCallback(() => {}, { returns: "void", args: [] }).close();
    return true;
  } catch (error) {
    return (error as Error).message !== refusal;
  }
}

describe.skipIf(callsNativeFunctions())("a Bun built with --ffi=off", () => {
  test("bun:ffi makes no function and no callback", async () => {
    const source = `
      const { CFunction, JSCallback, linkSymbols } = require("bun:ffi");
      const signature = { returns: "int", args: [] };
      for (const make of [
        () => linkSymbols({ main: { ...signature, ptr: 1n } }),
        () => CFunction({ ...signature, ptr: 1n }),
        () => new JSCallback(() => 1, signature),
      ]) {
        try { make(); console.log("made"); } catch (error) { console.log(error.name + ": " + error.message); }
      }
    `;
    expect(await run(source)).toEqual({
      stdout: Array(3)
        .fill("TypeError: " + refusal)
        .join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(isWindows || !compiler)("dlopen() and cc() load no library", async () => {
    using dir = tempDir("build-left-out-features", {
      "library.c": `#include <unistd.h>
__attribute__((constructor)) static void loaded(void) { (void)!write(1, "loaded\\n", 7); }
int answer(void) { return 42; }`,
      "source.c": "int answer(void); int twice(void) { return 2 * answer(); }",
    });
    const library = join(String(dir), "libanswer.so");
    await using compile = Bun.spawn({
      cmd: [compiler!, "-shared", "-fPIC", "-o", library, join(String(dir), "library.c")],
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await compile.exited).toBe(0);
    const source = `
      const { cc, dlopen } = require("bun:ffi");
      const signature = { returns: "int", args: [] };
      for (const load of [
        () => dlopen(process.env.LIBRARY, { answer: signature }),
        () => cc({ source: process.env.SOURCE, library: ["answer"], flags: ["-L" + process.env.DIRECTORY], symbols: { twice: signature } }),
      ]) {
        try { load(); console.log("returned"); } catch (error) { console.log(error.name + ": " + error.message); }
      }
    `;
    const env = { LIBRARY: library, SOURCE: join(String(dir), "source.c"), DIRECTORY: String(dir) };
    expect(await run(source, env)).toEqual({
      stdout: Array(2)
        .fill("TypeError: " + refusal)
        .join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!!unsupported)(
    "an executable that evaluates text holds no code for calls of native functions",
    async () => {
      using dir = tempDir("build-left-out-features", {
        "main.js": `console.log((0, eval)(process.argv[2] ?? "1 + 1"));`,
      });
      const outfile = join(String(dir), isWindows ? "main.exe" : "main");
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", outfile],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
        stderr: expect.not.stringMatching(/^error\b/m),
        exitCode: 0,
      });
      const file = readFileSync(outfile);
      const image = findImage(file);
      expect(file.readUInt32LE(image + imageHeader.flags) & imageFlag.admitsUnknownJavaScript).not.toBe(0);
      expect(file.readUInt32LE(image + imageHeader.ffiCodeSize)).toBe(0);
    },
    120_000,
  );

  test("what calls nothing stays", async () => {
    expect(
      await run(
        `const { ptr, suffix } = require("bun:ffi"); console.log(typeof ptr(new Uint8Array(8)), typeof suffix)`,
      ),
    ).toEqual({
      stdout: "number string",
      stderr: "",
      exitCode: 0,
    });
  });
});
