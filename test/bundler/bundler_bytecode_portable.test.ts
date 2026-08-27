import { internalModuleBytecode } from "bun:internal-for-testing";
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
// This test is also what guards the format's portability: JavaScriptCore does not assert that its cache records are
// laid out identically by every compiler; it relies on this corpus reaching every record type and every opcode so that
// a platform that lays one out differently shows up here. Coverage when it was written, measured against JSC with
// llvm-cov on runtime/CachedTypes.cpp and an opcode histogram at generation time: every encode path user source can
// reach (every Cached* record type and presence bit, every CachedJSValue kind, 8- and 16-bit / inline / shared /
// payload-aliased strings, 16- and 32-bit metadata tables, wide16 and wide32 operands, multi-page payloads, out-of-line
// jump targets, every jump/switch table kind, shared identical arrays), and 170 of JSC's 194 bytecode opcodes. The
// other 24 cannot appear in a cached code block built from user source: they are emitted only for @-intrinsics in
// JSC's own builtins (op_create_promise, op_new_generator, op_new_array_with_species, op_to_object, op_is_callable,
// op_identity_with_profile, op_has_structure_with_flags, op_is_undefined_or_null unfused), only under a
// debugger/profiler option (op_debug, op_profile_type, op_profile_control_flow, op_super_sampler_begin/end,
// op_log_shadow_chicken_prologue/tail), only with USE(BIGINT32) (op_is_big_int), are rewritten away before a code
// block is final (op_yield, op_create_generator_frame_environment), have no emitter (op_below, op_beloweq, op_jbelow,
// op_jbeloweq, op_define_accessor_property), or belong to the call-kind stub of a class constructor, which is not what
// gets cached (op_unreachable). For breadth, several real-world libraries from test/node_modules (versions pinned in
// test/package.json) go through the same check; bumping one of them moves its hash on every platform at once, which is
// the "update the snapshot" case above.
const corpusDir = join(import.meta.dir, "bytecode-portability");
const featuresSource = readFileSync(join(corpusDir, "features.js"), "utf8");
const recordsSource = readFileSync(join(corpusDir, "records.js"), "utf8");
const builtinSource = readFileSync(join(corpusDir, "builtin.js"), "utf8");
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
  `"hoisted" 3 [5,6,5] "twomany" "1,argumentCount,postfix,2"`,
  `["p1","p2",0,2,8,"p","q","r","s2","00","10","11","20","21","22",7,1,3,2,"undefined"]`,
].join("\n");

const recordsOutput = [
  "strings: \"aababcabcd\" 46 48 47 49 13 1 \"zero\" \"one point five\" \"neg\" 19 12",
  "constants: 1131776 \"0.5,-0.5,1,1e+21,1e-7,2147483648,-2147483649,4294967295,9007199254740991,9007199254740992,1.7976931348623157e+308,5e-324,-0,0.30000000000000004,3.141592653589793\" \"Infinity,-Infinity,undefined,null,true,false\" \"|s|st|str|string|ストリング\" true \"undefined\"",
  "arrays: 12 1.5 2.5 true \"xyyzzzwwww\" \"number,string,number,boolean,object,undefined\" 4 6 false 2 3 0 64 32 11 8",
  "regexps: \"|g|i|m|s|u|y|d|v|dgimsy||||u|u|||u|v|\" \"0,0,0,0,0,0,0,0,0,0,2,3,0,5,6,0,3,9,1,0\" true \"yy\" \"c\"",
  "templates: [1,\"\",\"\",0] [1,\"one\",\"one\",0] [4,\"a|b|c|d\",\"a|b|c|d\",3] [2,2,\"\\n\\t\\\\|ABC\",1] [1,1,\"U\",0] [2,2,\"日本|テキスト\",1] [4,\"|||\",\"|||\",3] [1,1,\"\\nmulti\\nline\",0] \"one\" true",
  "bigints: \"0,1,-1,127,128,255,256,65535,4294967295,4294967296,18446744073709551615,18446744073709551616,-18446744073709551616,31,15,5,1000000,123456789012345678901234567890123456789012345678901234567890\" 123456789012345678901234567890123456789030792422983535120448n 61",
  "switches: \"b-daxy2B5snb\" \"-c--28?4m\" \"--b-0?5m\" \"---d27J5m\"",
  "handlers: \"t1\" \"c2:1\" \"t3\" \"f3\" \"c4:d\" \"f4\" \"f5\" \"c5:3\" \"fi1\" \"i2\" \"fi2\" \"fi3\" \"fr\" \"r\" \"fg\" 3 \"ff\" \"TypeError:inner!\"",
  "spread/rest: [2,3,3,9,6,3] [2,3,3,9,6,3] \"qrst日\" \"rst日\" \"pq\" 6 28 [6,7,7,6]",
  "scopes: 6 10 3 104 5 3 190 15 10 \"0,1,10,11,20,21\" \"ib\"",
  "tdz: 15 3 2 7 8",
  "functions: \"|||||\" \"1|prop|arrowProp|computed\" \"[sym]\" true \"assigned\" [9,9,1,2,4,3,0] [0,1,8,0,1,2] 6 4 \"col\" 9 25 \"DerivedModes\" 4 4 2 1 6",
  "rareData: \"U,1,2,3,U,4,U,5,U,6,7,8,11,12\" \"function\" 1 7 4 3 2 1 2 true \"Elements\"",
  "objects: \"0,1,2,9,4,3,1,1,1,1,5,1,0,1,3,1,1\" 7 \"[object Object]\" null 2",
  "control: \"b\" \"a\" 2 4 0 21 \"a\" \"b\" \"1m\" \"x\" \"y\" \"0\" \"1\" \"called\" \"idx\" undefined \"called\" \"d\" \"e\" \"f\" 3 \"f\" \"or\" 0 0 true false \"undefined\" \"undefined\" false true true true true true true \"comma\" undefined 3 4 7 \"t0e1mnested0p\" \"r\\\\n0\" true undefined \"|\" 2 4 0 21 \"a\" \"b\" \"1m\" \"x\" \"y\" \"0\" \"1\" \"called\" \"idx\" undefined \"called\" \"d\" \"e\" \"f\" 3 \"t\" 1 \"and\" 1 false true \"undefined\" \"undefined\" false true true true true true true \"comma\" undefined 3 4 7 \"t1e2mnested1p\" \"r\\\\n1\" \"elif\" true undefined",
  "generators: 1 2 3 \"i\" 4 5 \"sent\"",
  "expressionInfo: 177 178",
  "sloppy: 2 \"w\" \"function\" 1 \"function\" \"function\" \"object\"",
  "async: 12 2 1 3 6 \"1,2,3,4,2\"",
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
    `var huge = "${Buffer.alloc(70000, "0123456789abcdef").toString()}";`,
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
// Sweeps of one parameter at a time across the boundaries the encodings have: string lengths (inline <= 3, alias >= 48)
// in both widths, integers around each varint/int32 boundary, switch table sizes, parameter and field counts, closure
// nesting depth, array literal lengths. Generated (same bytes every time) rather than checked in.
const shapesOutput = "16257";
function shapesSource() {
  const lines = ["var acc = 0, s;"];
  for (let n = 0; n <= 64; n++) lines.push(`s = "${Buffer.alloc(n, "x")}"; acc += s.length; s = "${"é".repeat(n)}"; acc += s.length; s = "${"字".repeat(n)}"; acc += s.length;`);
  for (const b of [7, 8, 14, 15, 16, 21, 22, 28, 29, 31, 32, 33, 52]) for (const d of [-1, 0, 1]) lines.push(`acc += ${2 ** b + d} % 7; acc -= ${-(2 ** b) + d} % 5;`);
  for (let n = 1; n <= 24; n++) {
    lines.push(`function sw${n}(v) { switch (v) { ${Array.from({ length: n }, (_, i) => `case ${i * (n % 3 + 1)}: return ${i};`).join(" ")} default: return -1; } } acc += sw${n}(${n - 1});`);
    lines.push(`function ss${n}(v) { switch (v) { ${Array.from({ length: n }, (_, i) => `case "k${Buffer.alloc(i, "q")}": return ${i};`).join(" ")} default: return -1; } } acc += ss${n}("k${Buffer.alloc(n - 1, "q")}");`);
    lines.push(`function p${n}(${Array.from({ length: n }, (_, i) => "a" + i).join(", ")}) { return arguments.length + a${n - 1}; } acc += p${n}(${Array.from({ length: n }, (_, i) => i).join(", ")});`);
    lines.push(`class C${n} { ${Array.from({ length: n }, (_, i) => `f${i} = ${i}; #p${i} = ${i};`).join(" ")} sum() { return ${Array.from({ length: n }, (_, i) => `this.f${i} + this.#p${i}`).join(" + ")}; } } acc += new C${n}().sum();`);
    lines.push(`acc += [${Array.from({ length: n }, (_, i) => i).join(", ")}].length + [${Array.from({ length: n }, (_, i) => i + 0.5).join(", ")}].length + [${Array.from({ length: n }, (_, i) => `"e${i}"`).join(", ")}].length;`);
    lines.push(`acc += ${Array.from({ length: n }, (_, i) => i).reduceRight((inner, i) => `(v${i} => ${inner})(${i})`, Array.from({ length: n }, (_, i) => "v" + i).join(" + "))};`); // n nested arrows, the innermost capturing every parameter
  }
  for (let depth = 1; depth <= 12; depth++) lines.push(`acc += (function d${depth}_0() { let v0 = ${depth}; ${Array.from({ length: depth }, (_, i) => `return (function d${depth}_${i + 1}() { let v${i + 1} = v${i} + 1;`).join(" ")} return ${Array.from({ length: depth + 1 }, (_, i) => "v" + i).join(" + ")}; ${"})();".repeat(depth)} })();`);
  lines.push("console.log(acc);");
  return lines.join("\n") + "\n";
}


const corpusBuilds = [
  { name: "bun build --bytecode features.js", entry: "./features.js", args: [] as string[], output: featuresOutput },
  { name: "bun build --bytecode --minify features.js", entry: "./features.js", args: ["--minify"], output: featuresOutput },
  { name: "bun build --bytecode records.js", entry: "./records.js", args: [] as string[], output: recordsOutput },
  { name: "bun build --bytecode --minify records.js", entry: "./records.js", args: ["--minify"], output: recordsOutput },
  { name: "bun build --bytecode big.js", entry: "./big.js", args: [] as string[], output: bigOutput },
  { name: "bun build --bytecode shapes.js", entry: "./shapes.js", args: [] as string[], output: shapesOutput },
];
// Entries are relative to the corpus directory so the module paths the bundler writes into its output are the same on
// every machine. (A library that uses __dirname / __filename cannot be here: the bundler inlines them as absolute paths.)
const libraries = [
  "lodash/lodash.js",
  "acorn/dist/acorn.mjs",
  "react-dom/cjs/react-dom.development.js",
  "svelte/compiler/index.js",
  "undici/index.js",
  "happy-dom/lib/index.js",
  "immutable/dist/immutable.es.js",
];
const libraryBuilds = libraries.map(lib => ({ name: `bun build --bytecode ${lib}`, entry: `../../node_modules/${lib}`, args: [] as string[] }));
const bundlerBuilds = [...corpusBuilds, ...libraryBuilds];

// big.js is generated next to the checked-in corpus once per run (same bytes every time).
const bigPath = join(corpusDir, "big.js");
writeFileSync(bigPath, bigSource());
writeFileSync(join(corpusDir, "shapes.js"), shapesSource());

async function bundle(
  outdir: string,
  entry: string,
  args: readonly string[],
  env: Record<string, string | undefined> = bunEnv,
) {
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
  const output = name.replace(/\.[cm]?js$/, ".js"); // the bundler names its output .js whatever the entry's extension
  expect(readdirSync(outdir).sort()).toEqual([output, output + ".jsc"]);
  return { js: readFileSync(join(outdir, output)), jsc: readFileSync(join(outdir, output + ".jsc")) };
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
    outputs["vm.Script shapes.js"] = fingerprint("vm.Script shapes.js", new vm.Script(shapesSource(), { filename: "shapes.js", produceCachedData: true }).cachedData!);
    outputs["vm.Script records.js"] = fingerprint(
      "vm.Script records.js",
      new vm.Script(recordsSource, { filename: "records.js", produceCachedData: true }).cachedData!,
    );
    // A builtin (what `bun build --compile --bytecode` embeds for node:* / bun:* modules): @-intrinsics and the
    // builtin-executable entry, which user source never produces. Bun's own internal modules are not hashed here because
    // their source is per-OS (process.platform is inlined); the next test covers them.
    outputs["builtin corpus"] = fingerprint("builtin corpus", internalModuleBytecode(builtinSource, "corpus:builtin").bytecode);
    outputs["vm.SourceTextModule module.js"] = fingerprint(
      "vm.SourceTextModule module.js",
      new vm.SourceTextModule(moduleSource, { identifier: "module.js" }).createCachedData(),
    );
    outputs["vm.Script big.js"] = fingerprint(
      "vm.Script big.js",
      new vm.Script(bigSource(), { filename: "big.js", produceCachedData: true }).cachedData!,
    );
    const librarySource = (lib: string) => readFileSync(join(corpusDir, "../../node_modules", lib), "utf8");
    outputs["vm.Script lodash.js"] = fingerprint(
      "vm.Script lodash.js",
      new vm.Script(librarySource("lodash/lodash.js"), { filename: "lodash.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script typescript.js"] = fingerprint(
      "vm.Script typescript.js",
      new vm.Script(librarySource("typescript/lib/typescript.js"), { filename: "typescript.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.SourceTextModule acorn.mjs"] = fingerprint(
      "vm.SourceTextModule acorn.mjs",
      new vm.SourceTextModule(librarySource("acorn/dist/acorn.mjs"), { identifier: "acorn.mjs" }).createCachedData(),
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
        "builtin corpus": {
          "bytes": 6144,
          "sha256": "0b549d456059c9a9fcda414a3c3ea691eeb9f53cfee59df5e4a1b83fe00fdff0",
        },
        "bun build --bytecode --minify features.js": {
          "js": "9f5f15dbd326293b6805304febe9fb19f9d26531d2bb8c10e80d80e126f19a2d",
          "jsc": {
            "bytes": 46280,
            "sha256": "a8a9d6ba88e31eaaacee53b6a721cf7aeb02bca5ac2dd6e0be9b0d2586c79648",
          },
        },
        "bun build --bytecode --minify records.js": {
          "js": "475a38e69ac7da866c59406f5046d31af4835dd159ef36e03bc1fe4ed6b24f34",
          "jsc": {
            "bytes": 89200,
            "sha256": "3d791c358b798bf013224fb8a26b8668a00a03c9db801c8b986d3346a8d0d95b",
          },
        },
        "bun build --bytecode acorn/dist/acorn.mjs": {
          "js": "2ed858fa1b38a20673cee13a857ccdaedb9da0a325ebc47e81c4851de77eef3c",
          "jsc": {
            "bytes": 266064,
            "sha256": "4b431a514916bb73e8daba7977ca1ca8d3cdec350c57e45222ff9b0a56691498",
          },
        },
        "bun build --bytecode big.js": {
          "js": "df5367354d3dbd2b81114585fb2a21d058910c869ece4404ef015c0efaf5c689",
          "jsc": {
            "bytes": 168656,
            "sha256": "cf4792f2ea174083447f9fa12860dce4e08ac5a22774cc80c3ea02b5ffb87e64",
          },
        },
        "bun build --bytecode features.js": {
          "js": "119167da75fb91bb0c0cd490210afaa26cf138c3509333f335a7134eb1b6cfde",
          "jsc": {
            "bytes": 48184,
            "sha256": "4033793fb658444392f16cb7e910be4656aae7876fc28334e7fbf3c2aaeeff6a",
          },
        },
        "bun build --bytecode happy-dom/lib/index.js": {
          "js": "148f0d3e4baf485281725f859deb3e717a6da25a4a08de9af288d5ef54b6414b",
          "jsc": {
            "bytes": 2528768,
            "sha256": "4db53783f201244955f339dd9d9e0755004ca429d265b79e8a345a93ae07e7f4",
          },
        },
        "bun build --bytecode immutable/dist/immutable.es.js": {
          "js": "c9a2ba9f6b6a662e6bdfd44128bc66284276f5eac2a8875adb4578472328dc9f",
          "jsc": {
            "bytes": 280016,
            "sha256": "2a99c33a2516e2d41187bc322ddd4523318530b51c60c3d9a8bd566d4f2929a1",
          },
        },
        "bun build --bytecode lodash/lodash.js": {
          "js": "0b575ee1213807337c15c47d07864bb299cc361a983c8668f0ba164d646aa210",
          "jsc": {
            "bytes": 346976,
            "sha256": "3047eae43d99d73191c7d3eed6eb5505ee27fcdc3de041507b2000caf5f3adfe",
          },
        },
        "bun build --bytecode react-dom/cjs/react-dom.development.js": {
          "js": "06099121265fa73020167d9aa9a72adf8f7e92f9c5f9ae801c52ea5248aab2a6",
          "jsc": {
            "bytes": 979432,
            "sha256": "3afdbd09ae9ee90215811d5ea0c0a08f19414383bb0fbe1cc0f7a7c929ac2446",
          },
        },
        "bun build --bytecode records.js": {
          "js": "41169a8eee0403a71e1ba5eaca3604b44e6947e83d0794abb7f7e639880641d2",
          "jsc": {
            "bytes": 91984,
            "sha256": "f85b22e88bfca2ea1484d71c232ef7f57a53c4ed76cdd0dee1b23572aa208867",
          },
        },
        "bun build --bytecode shapes.js": {
          "js": "dfcf0136de2c98f6a29d2c41477637879ccae98385a1bf30c666b85002bcae07",
          "jsc": {
            "bytes": 249808,
            "sha256": "faefe10b64458d7b978ee6d2339e95aee17e1114a878cd39a6d52860c6944d26",
          },
        },
        "bun build --bytecode svelte/compiler/index.js": {
          "js": "91d38e665639adcb4ec160c966e6d72161ee07083363c04670ee82e82c001414",
          "jsc": {
            "bytes": 1995984,
            "sha256": "d7e03d48ff4b43d79d442bcbd5a8b12169323f86841ae1ba19a933e5133c3a16",
          },
        },
        "bun build --bytecode undici/index.js": {
          "js": "d0bd3791e7c8f77a06814429d5d95cb26a06baaa3c135502bcd3e984310f1d2c",
          "jsc": {
            "bytes": 936872,
            "sha256": "22d555a85e721a83f3699456b8cbee6f3ef6675b7dc217807affc8bf2fb46b71",
          },
        },
        "vm.Script big.js": {
          "bytes": 168560,
          "sha256": "5666dd9957cb8fb428d8fb690ef722eee980a7dc9dd8657c227af498f511441e",
        },
        "vm.Script features.js": {
          "bytes": 48232,
          "sha256": "aaf19b57794b38aebded10c25cde40810c5e0ba96148400070ee1131649f4ae4",
        },
        "vm.Script lodash.js": {
          "bytes": 354672,
          "sha256": "ff430fa41f4192baaeb922b03ff28b68609abc2e41e40016d15a078af984d042",
        },
        "vm.Script records.js": {
          "bytes": 93112,
          "sha256": "593b71284b1e7fa24e74f702a28a2b986b01fe92f97a58af4d27141001b8b4ef",
        },
        "vm.Script shapes.js": {
          "bytes": 289040,
          "sha256": "5e9cae2030a97a0d122cbbe22c34461d871394253a03dc3ae1dede5eeab9cd5e",
        },
        "vm.Script typescript.js": {
          "bytes": 12095328,
          "sha256": "6522583256b6d7f0485d895dcfcce4cb967139dc5ed93c08645ae1c818fb9758",
        },
        "vm.SourceTextModule acorn.mjs": {
          "bytes": 264064,
          "sha256": "40753e7df6bc75e5c542aa436f94163a2dd473adf10ca2e77e452a67b8332290",
        },
        "vm.SourceTextModule module.js": {
          "bytes": 9736,
          "sha256": "695d888a03c1b8257b89f01b5229009db9c38e065d53b98ed8f963ef399ce74d",
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
        const { internalModuleBytecode } = require("bun:internal-for-testing");
        const mask = b => { b = new Uint8Array(b); b.fill(0, 0, 4); b.fill(0, 8, 12); return b; }; // as fingerprint() does
        const internalModules = {};
        for (let i = 0, m; (m = internalModuleBytecode(i)); i++) internalModules[m.name] = new Bun.CryptoHasher("sha256").update(mask(m.bytecode)).digest("hex");
        require("fs").writeFileSync(outdir + "/internal-modules.json", JSON.stringify(internalModules));
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

    // Every one of Bun's internal modules as builtin bytecode, in this process and in the busy one: same bytes.
    const internalModules: Record<string, string> = {};
    for (let i = 0, m; (m = internalModuleBytecode(i)); i++) internalModules[m.name] = hash(m.bytecode);
    expect(Object.keys(internalModules).length).toBeGreaterThan(100);
    expect(JSON.parse(readFileSync(join(String(dir), "api", "internal-modules.json"), "utf8"))).toEqual(internalModules);

    const vmExpected = hash(
      new vm.Script(featuresSource, { filename: "features.js", produceCachedData: true }).cachedData!,
    );
    expect({
      "vm.Script#createCachedData() after running it, in a busy VM": hash(
        readFileSync(join(String(dir), "api", "vm.cached")),
      ),
    }).toEqual({ "vm.Script#createCachedData() after running it, in a busy VM": vmExpected });
  });

  // Identical bytes only help if this platform also decodes what it encodes.
  for (const { name, entry, args, output } of corpusBuilds) {
    test.concurrent(`output of \`${name}\` loads from the cache`, async () => {
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
      expect(stdout).toBe(output + "\n");
      expect(exitCode).toBe(0);
    });
  }

  for (const [file, source, output] of [["features.js", featuresSource, featuresOutput], ["records.js", recordsSource, recordsOutput]] as const) {
    test.concurrent(`vm.Script cachedData for ${file} is accepted and runs`, async () => {
      const { cachedData } = new vm.Script(source, { filename: file, produceCachedData: true });
      const script = new vm.Script(source, { filename: file, cachedData });
      expect(script.cachedDataRejected).toBe(false);
      const lines: string[] = [];
      const context = vm.createContext({ console: { log: (...args: unknown[]) => lines.push(args.join(" ")) } });
      await script.runInContext(context); // both scripts end in the promise that prints their output
      expect(lines.join("\n")).toBe(output);
    });
  }
});
