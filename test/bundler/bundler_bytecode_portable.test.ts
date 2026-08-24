import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import vm from "node:vm";
import { basename, join } from "path";
import { gzipSync } from "zlib";

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
//
// Coverage of the corpus (features.js + module.js + the generated big.js), measured against JSC with llvm-cov on
// runtime/CachedTypes.cpp and --dumpGeneratedBytecodes when it was written: every encode path that user source can
// reach (every Cached* record type, every CachedJSValue kind, 8- and 16-bit / inline / shared / payload-aliased strings,
// 16- and 32-bit metadata tables, multi-page payloads, out-of-line jump targets, every jump/switch table kind), and 173
// of JSC's 194 bytecode opcodes. The other 21 cannot appear in a cached code block built from source: they are emitted
// only for @-intrinsics in JSC's own builtins (op_argument_count is the exception that leaks into user code and is
// covered; op_create_promise, op_new_generator, op_identity_with_profile, op_has_structure_with_flags,
// op_is_undefined_or_null unfused), only under a debugger/profiler option (op_debug, op_profile_type,
// op_profile_control_flow, op_super_sampler_begin/end, op_log_shadow_chicken_prologue/tail), only with USE(BIGINT32)
// (op_is_big_int), are rewritten away before a code block is final (op_yield, op_create_generator_frame_environment),
// have no emitter (op_below, op_beloweq, op_jbelow, op_jbeloweq, op_define_accessor_property), or belong to the
// call-kind stub of a class constructor, which is not what gets cached (op_unreachable).
const corpusDir = join(import.meta.dir, "bytecode-portability");
const featuresSource = readFileSync(join(corpusDir, "features.js"), "utf8");
const moduleSource = readFileSync(join(corpusDir, "module.js"), "utf8");

const featuresOutput = [
  `"two:g" "many:?"`,
  `"finally"`,
  `[1.5,2.25,-0.5,1e+21] ["x",7,null,true] [1,2,3,4,5] "ab/2020" -37037036703703703670369n "a|b|c#1,2" "TypeError" "t4"`,
  `"Derived(Base(1), 2, 82, 42)" 42 true false 1 "Base(5)"`,
  `[0,11,22,1] ["dflt",1024,true,false,true,"undefined",null,2]`,
  `[5,3.5,1,49,-7,null,-8,2,7,5,28,1,1,false] 1 [false,true,true,false,false,false,true,true,false,true] "jg,jge,jneq,jeqn,jnseq,jnl,jnle" [false,false,true,true,false,false,false,false,true,false]`,
  `8 40 7 3 "kfn" true ["Object",1] [7,7] "symbol"`,
  `6 6 6 3 4 3 6 4 "undefined" 3`,
  `1 "aliased" "b2" 2 "function" "object" "p2" 2 "p2" 2 3 "function"`,
  `6 "sent" "gen" "asyncFn" "asyncArrow" 2 2 9 true 3 4 5 6 -1`,
  `"a|ab|abc||abcd" 20 72 50 1 3 false 11 "0,1,-1,18446744073709551616,18446744073709551615" ",dgimsuy,v,v" 3 [3,"x",2] true 122`,
  `"function" "function/undefined" 17 1024 0.25 3 null 0.0010000000000000002 4 2`,
  `["p1","p2",0,2,8,"p","q","r","s2","00","10","11","20","21","22",7,1,3,2,"undefined"]`,
].join("\n");

// One function large enough to need what small ones never do: >255 locals (wide16 operands), a metadata table past
// 64 KB (32-bit offsets), forward jumps too long for their operand (out-of-line jump targets), a 300-case string switch,
// a string constant bigger than an encoder page, and a payload spanning several encoder pages.
function bigSource() {
  const locals = 300,
    calls = 600,
    cases = 300;
  const lines = [
    "var o = {};",
    `for (var i = 0; i < ${calls}; i++) o["m" + i] = function (x) { return x + 1; };`,
    `var huge = "${"0123456789abcdef".repeat(70000 / 16)}";`,
    "function big(flag, s) {",
    "  var " + Array.from({ length: locals }, (_, i) => `v${i} = ${i}`).join(", ") + ";",
    "  var r = 0;",
    "  if (flag) {",
    ...Array.from({ length: calls }, (_, i) => `    r += o.m${i}(v${i % locals});`),
    "  }",
    "  switch (s) {",
    ...Array.from({ length: cases }, (_, i) => `    case "case${i}": r += ${i}; break;`),
    "    default: r = -r;",
    "  }",
    "  return r + huge.length;",
    "}",
    'console.log(big(true, "case7"), big(false, "nope"));',
  ];
  return lines.join("\n") + "\n";
}
const bigOutput = "160307 70000";

const bundlerBuilds = [
  { name: "bun build --bytecode features.js", entry: "./features.js", args: [] },
  { name: "bun build --bytecode --minify features.js", entry: "./features.js", args: ["--minify"] },
  { name: "bun build --bytecode big.js", entry: "./big.js", args: [] },
] as const;

// big.js is generated next to the checked-in corpus once per run (same bytes every time).
const bigPath = join(corpusDir, "big.js");
writeFileSync(bigPath, bigSource());

async function bundle(outdir: string, entry: string, args: readonly string[], env: Record<string, string | undefined> = bunEnv) {
  const name = basename(entry);
  await using proc = Bun.spawn({
    // Relative entry + fixed cwd: the unminified output names each module by its path relative to cwd.
    cmd: [bunExe(), "build", "--bytecode", "--target=bun", ...args, "--outdir", outdir, entry],
    cwd: corpusDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(readdirSync(outdir).sort()).toEqual([name, name + ".jsc"]);
  return { js: readFileSync(join(outdir, name)), jsc: readFileSync(join(outdir, name + ".jsc")) };
}

// The payload starts with GenericCacheEntry { uint32 cacheVersion; uint32 headerSize; uint32 headerChecksum; ... }.
// cacheVersion is a hash of the WebKit version string and headerChecksum covers it, so both change on every WebKit
// upgrade whether or not the format did; mask them so the snapshot only moves when the serialized bytes do.
const payloads: Record<string, Uint8Array> = {};
function fingerprint(name: string, bytecode: Uint8Array) {
  const copy = new Uint8Array(bytecode);
  copy.fill(0, 0, 4);
  copy.fill(0, 8, 12);
  payloads[name] = copy;
  return { sha256: Bun.CryptoHasher.hash("sha256", copy, "hex"), bytes: copy.byteLength };
}

// A mismatch found on a platform nobody has a shell on is only actionable with the bytes in hand.
function dumpPayloads() {
  for (const [name, payload] of Object.entries(payloads))
    console.log(`payload ${JSON.stringify(name)} (gzip, base64): ${gzipSync(payload).toString("base64")}`);
}

describe("bytecode cache portability", () => {
  test("encoder output is identical on every platform", async () => {
    using dir = tempDir("bytecode-portable", {});
    const outputs: Record<string, unknown> = {};
    for (const [i, { name, entry, args }] of bundlerBuilds.entries()) {
      const { js, jsc } = await bundle(join(String(dir), String(i)), entry, args);
      // If `js` differs between platforms the bundler is at fault, not the bytecode format.
      outputs[name] = { js: Bun.CryptoHasher.hash("sha256", js, "hex"), jsc: fingerprint(name, jsc) };
    }
    // Program and module code blocks straight from the encoder, without the bundler in between.
    outputs["vm.Script features.js"] = fingerprint(
      "vm.Script features.js",
      new vm.Script(featuresSource, { filename: "features.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.SourceTextModule module.js"] = fingerprint(
      "vm.SourceTextModule module.js",
      new vm.SourceTextModule(moduleSource, { identifier: "module.js" }).createCachedData(),
    );
    outputs["vm.Script big.js"] = fingerprint(
      "vm.Script big.js",
      new vm.Script(bigSource(), { filename: "big.js", produceCachedData: true }).cachedData!,
    );
    try {
      expectOutputs(outputs);
    } catch (e) {
      dumpPayloads();
      throw e;
    }
  });

  function expectOutputs(outputs: Record<string, unknown>) {
    expect(
      outputs,
      "serialized bytecode differs from the snapshot — read the comment at the top of this file before updating it",
    ).toMatchInlineSnapshot(`
      {
        "bun build --bytecode --minify features.js": {
          "js": "845ea6c8d04fa2d382915b58c652f01c2a1bf124b588f837f3554fa5b24a1d77",
          "jsc": {
            "bytes": 52800,
            "sha256": "7752dca4a9526b9aaa62cb2e3de8109febec28c177618d51007bc080f7541263",
          },
        },
        "bun build --bytecode big.js": {
          "js": "df5367354d3dbd2b81114585fb2a21d058910c869ece4404ef015c0efaf5c689",
          "jsc": {
            "bytes": 166960,
            "sha256": "a66b81636f53b8251697a3c694e24ec8e84bb3f7d781a870165b740644a905d1",
          },
        },
        "bun build --bytecode features.js": {
          "js": "f379d51aef463e0c8060b6f31a3cf784dd783a036de345b8909ed084078f1f69",
          "jsc": {
            "bytes": 54552,
            "sha256": "613a0a30bf5754fa249084b00cc87b6881aa48b60b8141776ceede8684383775",
          },
        },
        "vm.Script big.js": {
          "bytes": 166792,
          "sha256": "fe5d1f42164a1e0e90f4e3e5a5e372004398fcd6167e12ec14b4a7f0de0bc735",
        },
        "vm.Script features.js": {
          "bytes": 53904,
          "sha256": "6c060dd330a6b6b048532848dace5d5e0ec31a9bf78b51020e2172ad70954e8a",
        },
        "vm.SourceTextModule module.js": {
          "bytes": 3144,
          "sha256": "adceee619784e4af53bfa6af5fd94ab6ddea4b4f1689d24909b9a9305863f350",
        },
      }
    `);
  }

  // ...and identical regardless of what the encoding process did before or during encoding: GC timing (which used to
  // decide whether the parser's SourceProviderCache survived), that cache being off, heap size, having run other JS
  // first (atom table / symbol counter state), or going through the JS API instead of the CLI. Compared against a
  // fresh CLI run rather than the snapshot, so this test needs no updating when the format changes.
  test("encoder output does not depend on the encoding process", async () => {
    using dir = tempDir("bytecode-portable-process", {
      "api.js": `
        for (let i = 0; i < 1000; i++) Symbol("s" + i); // symbol hash counter
        const wide = s => (s + "\u1234").slice(0, -1).split("\u1234").join("");
        globalThis.o = { [wide("classify")]: 1, [wide("literals")]: 2, [wide("ab")]: 3 }; // 16-bit atoms for corpus names
        const vm = require("node:vm");
        const [entry, outdir, source] = process.argv.slice(2);
        const script = new vm.Script(require("fs").readFileSync(source, "utf8"), { filename: "features.js" });
        script.runInNewContext({ console: { log() {} } }); // the corpus itself, parsed and run in this VM first
        require("fs").mkdirSync(outdir, { recursive: true });
        require("fs").writeFileSync(outdir + "/vm.cached", script.createCachedData()); // produced after running it
        const result = await Bun.build({ entrypoints: [entry], outdir, target: "bun", format: "cjs", bytecode: true });
        if (!result.success) throw new AggregateError(result.logs);
      `,
    });
    const { entry, args } = bundlerBuilds[0];
    const hash = (bytes: Uint8Array) => fingerprint("", bytes).sha256;
    const expected = hash((await bundle(join(String(dir), "default"), entry, args)).jsc);
    const conditions: Record<string, Record<string, string>> = {
      "collectContinuously": { BUN_JSC_collectContinuously: "1" },
      "useSourceProviderCache=0": { BUN_JSC_useSourceProviderCache: "0" },
      "gcMaxHeapSize=64KB": { BUN_JSC_gcMaxHeapSize: "65536" },
    };
    const results: Record<string, string> = {};
    for (const [condition, env] of Object.entries(conditions))
      results[condition] = hash((await bundle(join(String(dir), condition), entry, args, { ...bunEnv, ...env })).jsc);

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "api.js"), entry, join(String(dir), "api"), join(corpusDir, "features.js")],
      cwd: corpusDir, // as bundle() does, so module path comments in the output agree
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    results["Bun.build() after running other JS"] = hash(readFileSync(join(String(dir), "api", "features.js.jsc")));
    expect(results).toEqual(Object.fromEntries(Object.keys(results).map(k => [k, expected])));

    const vmExpected = hash(new vm.Script(featuresSource, { filename: "features.js", produceCachedData: true }).cachedData!);
    expect({ "vm.Script#createCachedData() after running it, in a busy VM": hash(readFileSync(join(String(dir), "api", "vm.cached"))) })
      .toEqual({ "vm.Script#createCachedData() after running it, in a busy VM": vmExpected });
  });

  // Identical bytes only help if this platform also decodes what it encodes.
  for (const { name, entry, args } of bundlerBuilds) {
    test(`output of \`${name}\` loads from the cache`, async () => {
      using dir = tempDir("bytecode-portable-run", {});
      await bundle(String(dir), entry, args);
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), basename(entry))],
        env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toStartWith("[Disk Cache] Cache hit for sourceCode");
      expect(stdout).toBe((entry === "./big.js" ? bigOutput : featuresOutput) + "\n");
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
