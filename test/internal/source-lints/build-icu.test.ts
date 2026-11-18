/** scripts/build/deps/icu.ts: which ICU a configuration compiles against and links. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig, type Config, type Toolchain } from "../../../scripts/build/config.ts";
import { icu } from "../../../scripts/build/deps/icu.ts";
import { zstd } from "../../../scripts/build/deps/zstd.ts";
import { fetchCliPath } from "../../../scripts/build/fetch-cli.ts";
import { checkSpelloutLocales, isShipped, staysUncompressed } from "../../../scripts/build/icu/items.ts";
import { readPackage, writePackage } from "../../../scripts/build/icu/package.ts";
import { Ninja, readManifest } from "../../../scripts/build/ninja.ts";
import { profiles } from "../../../scripts/build/profiles.ts";
import { registerAllRules } from "../../../scripts/build/rules.ts";
import { cargoBuildInvocation } from "../../../scripts/build/rust.ts";
import { resolveDep } from "../../../scripts/build/source.ts";
import { itemsOf } from "../../../scripts/build/trim/icu-data.ts";
import { packageOf } from "../icu-data-package.ts";

const target = (os: Config["os"], abi: Config["abi"], mode: Config["icu"]) =>
  ({ os, abi, icu: mode, linux: os === "linux", darwin: os === "darwin", localDeps: {} }) as Config;

const inherited = process.env.BUN_ICU_ROOT;
beforeEach(() => {
  delete process.env.BUN_ICU_ROOT;
});
afterEach(() => {
  if (inherited === undefined) delete process.env.BUN_ICU_ROOT;
  else process.env.BUN_ICU_ROOT = inherited;
});

test("the -local profiles, and no other, ask for the system's", () => {
  expect(
    Object.entries(profiles).flatMap(([name, profile]) => ("icu" in profile ? [[name, profile.icu]] : [])),
  ).toEqual([
    ["debug-local", "system"],
    ["release-local", "system"],
  ]);
});

test.each(["gnu", "musl"] as const)("the system's on linux-%s is found by name", abi => {
  const n = new Ninja({ buildDir: "/build" });
  expect(resolveDep(n, target("linux", abi, "system"), icu, new Map())).toEqual({
    name: "icu",
    libs: [],
    linkFlags: ["-licui18n", "-licuuc", "-licudata"],
    objects: [],
    includes: [],
    defines: [],
    outputs: [],
    checks: [],
  });
  expect(readManifest(n.toString()).edges.map(edge => [edge.rule, edge.outputs])).toEqual([["phony", ["icu"]]]);
});

test.each(["gnu", "musl", "android"] as const)("BUN_ICU_ROOT names a static one for linux-%s", abi => {
  process.env.BUN_ICU_ROOT = "/icu";
  expect(icu.provides(target("linux", abi, "system"))).toEqual({
    libs: ["libicui18n.a", "libicuuc.a", "libicudata.a"].map(name => join("/icu", "lib", name)),
    includes: [join("/icu", "include")],
  });
  expect(icu.provides(target("darwin", undefined, "system")).linkFlags).toEqual(["-licucore"]);
});

test.each([
  ["linux", "android", "android"],
  ["windows", undefined, "windows"],
  ["freebsd", undefined, "freebsd"],
] as const)("%s (%s) has none", (os, abi, name) => {
  expect(() => icu.provides(target(os, abi, "system"))).toThrow(`--icu=system: ${name} has no ICU of its own to link`);
});

// build.ninja spells paths with the host's separator; the expectations are written with `/`.
test.skipIf(isWindows)("the bundled one is fetched, and its data made by a tool for the host", () => {
  using dir = tempDir("build-icu", {});
  const buildDir = join(String(dir), "build");
  const tools = { cc: "/cc", cxx: "/c++", ar: "/ar", ld: "/ld", strip: "/strip", bun: "/bun", jsRuntime: "/node -x" };
  const cfg = {
    ...resolveConfig({ os: "linux", arch: "aarch64", abi: "gnu", linuxSysroot: "/fake", buildDir }, tools as Toolchain),
    cwd: String(dir),
    vendorDir: join(String(dir), "vendor"),
  };
  const n = new Ninja({ buildDir });
  registerAllRules(n, cfg);
  resolveDep(n, cfg, icu, new Map([["zstd", resolveDep(n, cfg, zstd, new Map())!]]));

  const { edges } = readManifest(n.toString());
  const edgeOf = (output: string) => edges.find(edge => edge.outputs.includes(output))!;
  const major = cargoBuildInvocation(cfg).unitEnv.BUN_ICU_MAJOR_VERSION;
  const fetch = edgeOf("../vendor/icu/.ref");
  expect(fetch.bindings.url).toContain(`/icu4c-${major}.`);
  expect(fetch.implicitOutputs).toContain(`../vendor/icu/source/data/in/icudt${major}l.dat`);
  expect(fetch.implicitOutputs.filter(output => !output.includes("/vendor/icu/"))).toEqual([]);
  expect(edgeOf("deps/icu/compress").bindings.flags).not.toContain("--target");
  expect(edgeOf("deps/icu/compress").implicitInputs).toContain("../vendor/zstd/.ref");
  expect(edgeOf("deps/icu/icudt.dat").bindings.cmd).toStartWith("/node -x ");
  const data = edgeOf("obj/scripts/build/icu/data.S.o");
  expect(data.implicitInputs).toEqual(expect.arrayContaining(["deps/icu/icudt.dat", "deps/icu/icudt.dict"]));
  expect(data.bindings.cflags).toContain(`=icudt${major}_dat`);
});

describe("data package", () => {
  const file = packageOf([
    ["icudt99l/af.res", 48],
    ["icudt99l/coll/de.res", 32],
    ["icudt99l/zoneinfo64.res", 33],
  ]);

  test("is read and written back", () => {
    const read = readPackage(file);
    expect(read.name).toBe("icudt99l");
    expect(read.items.map(({ name, data }) => [name, data.length])).toEqual([
      ["af.res", 48],
      ["coll/de.res", 32],
      ["zoneinfo64.res", 33],
    ]);
    expect(writePackage(read)).toEqual(file);
  });

  test("starts each item on a 16-byte boundary, where --trim finds it", () => {
    const items = [
      { name: "a.res", data: Buffer.from("one") },
      { name: "b/c.res", data: Buffer.alloc(17, 1) },
      { name: "d.res", data: Buffer.from("last") },
    ];
    const written = writePackage({ ...readPackage(file), items });
    expect(itemsOf(written)).toEqual([
      { name: "a.res", size: 16 },
      { name: "b/c.res", size: 32 },
      { name: "d.res", size: 4 },
    ]);
    for (const [index, { data }] of readPackage(written).items.entries()) {
      expect((data.byteOffset - written.byteOffset) % 16).toBe(0);
      expect(data.subarray(0, items[index].data.length)).toEqual(items[index].data);
    }
  });

  test("of another format is refused", () => {
    const bigEndian = Buffer.from(file);
    bigEndian[8] = 1;
    expect(() => readPackage(bigEndian)).toThrow("not a little-endian ICU data package");
    expect(() => readPackage(file.subarray(0, file.length - 40))).toThrow("lies outside it");
    expect(() => readPackage(packageOf([]))).toThrow("is empty");
    expect(() => readPackage(packageOf([["a/x.res", 16], ["b/y.res", 16]]))).toThrow("is not an item of the package a"); // prettier-ignore
  });
});

describe("items", () => {
  test.each([
    ["ibm-37_P100-1995.cnv", "dropped"],
    ["cnvalias.icu", "dropped"],
    ["rfc3491.spp", "dropped"],
    ["confusables.cfu", "dropped"],
    ["translit/root.res", "dropped"],
    ["unames.icu", "dropped"],
    ["rbnf/de.res", "dropped"],
    ["rbnf/zh_Hant_HK.res", "dropped"],
    ["rbnf/zh_Hant.res", "compressed"],
    ["rbnf/root.res", "compressed"],
    ["rbnf/res_index.res", "compressed"],
    ["de.res", "compressed"],
    ["zone/en.res", "compressed"],
    ["brkitr/word.brk", "compressed"],
    ["en_GB.res", "as it is"],
    ["uemoji.icu", "as it is"],
    ["zone/pool.res", "as it is"],
    ["coll/ucadata.icu", "as it is"],
    ["brkitr/cjdict.dict", "as it is"],
  ])("%s is %s", (name, fate) => {
    expect(!isShipped(name) ? "dropped" : staysUncompressed(name) ? "as it is" : "compressed").toBe(fate);
  });

  test("the spellout rules are those that the numbering systems name", () => {
    const naming = (...locales: string[]) => [
      {
        name: "numberingSystems.res",
        data: Buffer.from(["%roman-upper", ...locales.map(l => `${l}/SpelloutRules/%x`)].join("\0"), "utf16le"),
      },
    ];
    checkSpelloutLocales(naming("zh", "ja", "zh_Hant", "ja"));
    expect(() => checkSpelloutLocales(naming("ja", "ko", "zh", "zh_Hant"))).toThrow("rules of [ja,ko,zh,zh_Hant]");
    expect(() => checkSpelloutLocales(naming())).toThrow("rules of []");
    expect(() => checkSpelloutLocales([])).toThrow("no numberingSystems.res");
  });
});

describe("tarball source", () => {
  async function fetchTarball(checksum: (tarball: Uint8Array) => string) {
    using dir = tempDir("build-tarball", {
      "one.patch": "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-released\n+patched\n",
    });
    const tarball = await new Bun.Archive({ "top/file.txt": "released\n" }, { compress: "gzip" }).bytes();
    using server = Bun.serve({ port: 0, fetch: () => new Response(tarball) });
    const [dest, cache, patch] = ["dest", "cache", "one.patch"].map(name => join(String(dir), name));
    await using proc = Bun.spawn({
      cmd: [bunExe(), fetchCliPath, "tarball", "dep", server.url.href, checksum(tarball), dest, cache, patch],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      mismatch: stderr.includes("expected 00"),
      file: existsSync(dest) ? readFileSync(join(dest, "file.txt"), "utf8") : undefined,
      cached: readdirSync(cache).length,
      exitCode,
    };
  }

  test.concurrent("is unpacked and patched", async () => {
    expect(await fetchTarball(tarball => createHash("sha256").update(tarball).digest("hex"))).toEqual({
      mismatch: false,
      file: "patched\n",
      cached: 1,
      exitCode: 0,
    });
  });

  test.concurrent("is neither unpacked nor kept if its checksum differs", async () => {
    expect(await fetchTarball(() => "00")).toEqual({ mismatch: true, file: undefined, cached: 0, exitCode: 1 });
  });
});
