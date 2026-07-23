// `bun build --compile --target=<not-host>` caches the downloaded base
// executable under the bun install cache. That directory must be resolved
// through the same env-override chain `bun install` uses
// (BUN_INSTALL_CACHE_DIR -> BUN_INSTALL -> XDG_CACHE_HOME -> HOME),
// not a stub that only reads HOME.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Target darwin so inject() takes the Mach-O path on every host. The cached
// "binary" is a minimal Mach-O with a __BUN/__bun section big enough for the
// module graph, so the build completes in milliseconds without touching the
// network or the real (1GB) debug bun executable.
const VERSION_STR = "bun-darwin-x64-v1.0.99";
const TARGET_FLAG = "--target=bun-darwin-x64-modern-v1.0.99";

function machoTemplate(): Buffer {
  const MH_MAGIC_64 = 0xfeedfacf;
  const CPU_TYPE_X86_64 = 0x01000007;
  const MH_EXECUTE = 2;
  const LC_SEGMENT_64 = 0x19;
  const bunFileOff = 0x4000;
  const fileSize = 0x8100;
  const segCmdSize = 72;
  const sectSize = 80;
  const sizeofcmds = segCmdSize + sectSize + segCmdSize;
  const buf = Buffer.alloc(fileSize);
  const writeName = (off: number, name: string) => buf.write(name, off, 16, "latin1");

  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeInt32LE(CPU_TYPE_X86_64, 4);
  buf.writeInt32LE(3, 8);
  buf.writeUInt32LE(MH_EXECUTE, 12);
  buf.writeUInt32LE(2, 16);
  buf.writeUInt32LE(sizeofcmds, 20);

  let o = 32;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize + sectSize, o + 4);
  writeName(o + 8, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 24);
  buf.writeBigUInt64LE(0x4000n, o + 32);
  buf.writeBigUInt64LE(BigInt(bunFileOff), o + 40);
  buf.writeBigUInt64LE(0x4000n, o + 48);
  buf.writeInt32LE(7, o + 56);
  buf.writeInt32LE(3, o + 60);
  buf.writeUInt32LE(1, o + 64);

  o += segCmdSize;
  writeName(o, "__bun");
  writeName(o + 16, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 32);
  buf.writeBigUInt64LE(0x4000n, o + 40);
  buf.writeUInt32LE(bunFileOff, o + 48);
  buf.writeUInt32LE(14, o + 52);

  o += sectSize;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__LINKEDIT");
  buf.writeBigUInt64LE(0x1_0000_8000n, o + 24);
  buf.writeBigUInt64LE(0x1000n, o + 32);
  buf.writeBigUInt64LE(BigInt(bunFileOff + 0x4000), o + 40);
  buf.writeBigUInt64LE(0x100n, o + 48);
  buf.writeInt32LE(1, o + 56);
  buf.writeInt32LE(1, o + 60);

  return buf;
}

function placeValidBinary(root: string, relCacheDir: string) {
  const cacheDir = join(root, relCacheDir);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, VERSION_STR), machoTemplate());
}

function placeMarker(root: string, relCacheDir: string, marker: string) {
  const cacheDir = join(root, relCacheDir);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, VERSION_STR), marker);
}

async function build(cwd: string, env: NodeJS.Dict<string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", TARGET_FLAG, join(cwd, "entry.js"), "--outfile", join(cwd, "out")],
    env: env as NodeJS.Dict<string>,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("bun build --compile cross-compile cache directory resolution", () => {
  for (const [label, envVar, relCacheDir] of [
    ["BUN_INSTALL", "BUN_INSTALL", join("override", "install", "cache")],
    ["XDG_CACHE_HOME", "XDG_CACHE_HOME", join("override", ".bun", "install", "cache")],
  ] as const) {
    test(`honors $${label} ahead of $HOME`, async () => {
      using dir = tempDir("compile-cross-cache", {
        "entry.js": `console.log("ok");`,
      });
      const root = String(dir);

      // Wrong answer: the HOME-derived cache location. A bogus marker here makes
      // the inject step fail loudly if the override is ignored.
      placeMarker(root, join("home", ".bun", "install", "cache"), "WRONG-HOME-CACHE");
      // Correct answer: the higher-precedence override, pre-populated with a
      // valid Mach-O so no download is needed.
      placeValidBinary(root, relCacheDir);

      const env = {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: undefined,
        BUN_INSTALL: undefined,
        XDG_CACHE_HOME: undefined,
        HOME: join(root, "home"),
        USERPROFILE: join(root, "home"),
        [envVar]: join(root, "override"),
      };

      const { stderr, exitCode } = await build(root, env);
      expect({ stderr, exitCode }).toEqual({
        stderr: expect.not.stringContaining("error:"),
        exitCode: 0,
      });
      expect(await Bun.file(join(root, "out")).exists()).toBe(true);
    });
  }

  // Windows always provides USERPROFILE to new processes, so the "no HOME"
  // branch can't be reached there; the precedence tests above cover Windows.
  test.skipIf(isWindows)("falls back to node_modules/.bun-cache when no HOME-family var is set", async () => {
    using dir = tempDir("compile-cross-cache", {
      "entry.js": `console.log("ok");`,
    });
    const root = String(dir);

    // Stub fallback was `$cwd/.bun-cache`; the faithful port falls back to
    // `$cwd/node_modules/.bun-cache`. Seed both so neither code path needs
    // network: the build succeeds only when the node_modules path wins.
    placeMarker(root, ".bun-cache", "WRONG-STUB-FALLBACK");
    placeValidBinary(root, join("node_modules", ".bun-cache"));

    const env = {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: undefined,
      BUN_INSTALL: undefined,
      XDG_CACHE_HOME: undefined,
      HOME: undefined,
      USERPROFILE: undefined,
    };

    const { stderr, exitCode } = await build(root, env);
    expect({ stderr, exitCode }).toEqual({
      stderr: expect.not.stringContaining("error:"),
      exitCode: 0,
    });
    expect(await Bun.file(join(root, "out")).exists()).toBe(true);
  });
});
