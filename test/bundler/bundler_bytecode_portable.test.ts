import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import vm from "node:vm";
import { join } from "path";

// `bun build --compile --bytecode --target=<other platform>` embeds bytecode produced by this machine's JSC into an
// executable that another OS/CPU will decode. JSC's cache format is the in-memory image of C++ objects, so it is only
// portable if every compiler/ABI we ship lays those objects out identically and nothing about the encoding process
// (its struct sizes, heap addresses, page size) reaches the bytes. The encoder is written so that its output is a pure
// function of the input source; this test pins that output, and CI runs it on every platform. So:
//
//   - If the snapshot fails on EVERY platform (typically after a WebKit upgrade), the format simply changed: re-run
//     this file with `--update-snapshots` on any one machine and commit the result.
//   - If it fails on SOME platforms only, those platforms serialize bytecode differently from the rest, and executables
//     cross-compiled to or from them would crash or misbehave at runtime. Do not update the snapshot; fix the
//     divergence in JavaScriptCore's runtime/CachedTypes.cpp (the comment at the top of that file lists the causes).
const corpusDir = join(import.meta.dir, "bytecode-portability");
const featuresSource = readFileSync(join(corpusDir, "features.js"), "utf8");
const moduleSource = readFileSync(join(corpusDir, "module.js"), "utf8");

const featuresOutput = [
  `"two:g" "many:?"`,
  `"finally"`,
  `[1.5,2.25,-0.5,1e+21] ["x",7,null,true] [1,2,3,4,5] "ab/2020" -37037036703703703670369n "a|b|c#1,2" "TypeError" "t4"`,
  `"Derived(Base(1), 2, 82, 42)" 42 true false 1 "Base(5)"`,
  `[0,11,22,1] ["dflt",1024,true,false,true,"undefined",null,2]`,
  `["p1","p2",0,2,8,"p","q","r","s2","00","10","11","20","21","22",7,1,3,2,"undefined"]`,
].join("\n");

const bundlerBuilds = [
  { name: "bun build --bytecode features.js", args: [] },
  { name: "bun build --bytecode --minify features.js", args: ["--minify"] },
] as const;

async function bundle(outdir: string, args: readonly string[]) {
  await using proc = Bun.spawn({
    // Relative entry + fixed cwd: the unminified output names each module by its path relative to cwd.
    cmd: [bunExe(), "build", "--bytecode", "--target=bun", ...args, "--outdir", outdir, "./features.js"],
    cwd: corpusDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(readdirSync(outdir).sort()).toEqual(["features.js", "features.js.jsc"]);
  return { js: readFileSync(join(outdir, "features.js")), jsc: readFileSync(join(outdir, "features.js.jsc")) };
}

// The first 4 bytes are a hash of the WebKit version (GenericCacheEntry::m_cacheVersion), which changes on every
// upgrade whether or not the format did; everything after them is the serialized code block.
function fingerprint(bytecode: Uint8Array) {
  const copy = new Uint8Array(bytecode);
  copy.fill(0, 0, 4);
  return { sha256: Bun.CryptoHasher.hash("sha256", copy, "hex"), bytes: copy.byteLength };
}

describe("bytecode cache portability", () => {
  test("encoder output is identical on every platform", async () => {
    using dir = tempDir("bytecode-portable", {});
    const outputs: Record<string, unknown> = {};
    for (const { name, args } of bundlerBuilds) {
      const { js, jsc } = await bundle(join(String(dir), String(args.length)), args);
      // If `js` differs between platforms the bundler is at fault, not the bytecode format.
      outputs[name] = { js: Bun.CryptoHasher.hash("sha256", js, "hex"), jsc: fingerprint(jsc) };
    }
    // Program and module code blocks straight from the encoder, without the bundler in between.
    outputs["vm.Script features.js"] = fingerprint(
      new vm.Script(featuresSource, { filename: "features.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.SourceTextModule module.js"] = fingerprint(
      new vm.SourceTextModule(moduleSource, { identifier: "module.js" }).createCachedData(),
    );
    expect(
      outputs,
      "serialized bytecode differs from the snapshot — read the comment at the top of this file before updating it",
    ).toMatchInlineSnapshot(`
      {
        "bun build --bytecode --minify features.js": {
          "js": "0d5fba07e4f6ff812ee9534e829590b7cae04f6db1af13967818bf17d116db1c",
          "jsc": {
            "bytes": 46672,
            "sha256": "3730431920a12afda6e714beb8f399449b37e0559f34393561ef86c1367e11eb",
          },
        },
        "bun build --bytecode features.js": {
          "js": "2f4f87f33956b088710f61e07cf3c536c53c01c61c2f17608e8ccbcb5c5aa5d9",
          "jsc": {
            "bytes": 47184,
            "sha256": "264d0c90586782dcef9c42d9bf67216401f43757f4f02a6aad5073a27bdecbc2",
          },
        },
        "vm.Script features.js": {
          "bytes": 9256,
          "sha256": "a86962e4703126fd54fa5bfcabc3799982d5f69cf31635a1766e1769e04fab79",
        },
        "vm.SourceTextModule module.js": {
          "bytes": 4600,
          "sha256": "d7b6460687c5667fdcb92a018a81adbae6982b1efad4cd9b751b0aa60a20deac",
        },
      }
    `);
  });

  // Identical bytes only help if this platform also decodes what it encodes.
  for (const { name, args } of bundlerBuilds) {
    test(`output of \`${name}\` loads from the cache`, async () => {
      using dir = tempDir("bytecode-portable-run", {});
      await bundle(String(dir), args);
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "features.js")],
        env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.split("\n")[0]).toBe("[Disk Cache] Cache hit for sourceCode");
      expect(stdout).toBe(featuresOutput + "\n");
      expect(exitCode).toBe(0);
    });
  }

  test("vm.Script cachedData is accepted and runs", async () => {
    const { cachedData } = new vm.Script(featuresSource, { filename: "features.js", produceCachedData: true });
    const script = new vm.Script(featuresSource, { filename: "features.js", cachedData });
    expect(script.cachedDataRejected).toBe(false);
    const lines: string[] = [];
    const context = vm.createContext({ console: { log: (...args: unknown[]) => lines.push(args.join(" ")) } });
    await script.runInContext(context);
    expect(lines.join("\n")).toBe(featuresOutput);
  });
});
