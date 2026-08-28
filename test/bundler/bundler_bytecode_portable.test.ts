import { internalModuleBytecode } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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
  `"function" "function/undefined" 17 1024 65536 4 2`,
  `"hoisted" 3 [5,6,5] "twomany" "1,argumentCount,postfix,2"`,
  `["p1","p2",0,2,8,"p","q","r","s2","00","10","11","20","21","22",7,1,3,2,"undefined"]`,
].join("\n");

const recordsOutput = [
  'strings: "aababcabcd" 46 48 47 49 13 1 "zero" "one point five" "neg" 19 12',
  'constants: 1131776 "0.5,-0.5,1,1e+21,1e-7,2147483648,-2147483649,4294967295,9007199254740991,9007199254740992,1.7976931348623157e+308,5e-324,-0,0.30000000000000004,3.141592653589793" "Infinity,-Infinity,NaN,NaN,NaN,NaN,NaN,undefined,null,true,false" "|s|st|str|string|ストリング" true "undefined"',
  'arrays: 12 1.5 2.5 true "xyyzzzwwww" "number,string,number,boolean,object,undefined" 4 6 false 2 3 0 64 32 11 8',
  'regexps: "|g|i|m|s|u|y|d|v|dgimsy||||u|u|||u|v|" "0,0,0,0,0,0,0,0,0,0,2,3,0,5,6,0,3,9,1,0" true "yy" "c"',
  'templates: [1,"","",0] [1,"one","one",0] [4,"a|b|c|d","a|b|c|d",3] [2,2,"\\n\\t\\\\|ABC",1] [1,1,"U",0] [2,2,"日本|テキスト",1] [4,"|||","|||",3] [1,1,"\\nmulti\\nline",0] "one" true',
  'bigints: "0,1,-1,127,128,255,256,65535,4294967295,4294967296,18446744073709551615,18446744073709551616,-18446744073709551616,31,15,5,1000000,123456789012345678901234567890123456789012345678901234567890" 123456789012345678901234567890123456789030792422983535120448n 61',
  'switches: "b-daxy2B5snb" "-c--28?4m" "--b-0?5m" "---d27J5m"',
  'handlers: "t1" "c2:1" "t3" "f3" "c4:d" "f4" "f5" "c5:3" "fi1" "i2" "fi2" "fi3" "fr" "r" "fg" 3 "ff" "TypeError:inner!"',
  'spread/rest: [2,3,3,9,6,3] [2,3,3,9,6,3] "qrst日" "rst日" "pq" 6 28 [6,7,7,6]',
  'scopes: 6 10 3 104 5 3 190 15 10 "0,1,10,11,20,21" "ib"',
  "tdz: 15 3 2 7 8",
  'functions: "|||||" "1|prop|arrowProp|computed" "[sym]" true "assigned" [9,9,1,2,4,3,0] [0,1,8,0,1,2] 6 4 "col" 9 25 "DerivedModes" 4 4 2 1 6',
  'rareData: "U,1,2,3,U,4,U,5,U,6,7,8,11,12" "function" 1 7 4 3 2 1 2 true "Elements"',
  'objects: "0,1,2,9,4,3,1,1,1,1,5,1,0,1,3,1,1" 7 "[object Object]" null 2',
  'control: "b" "a" 2 4 0 21 "a" "b" "1m" "x" "y" "0" "1" "called" "idx" undefined "called" "d" "e" "f" 3 "f" "or" 0 0 true false "undefined" "undefined" false true true true true true true "comma" undefined 3 4 7 "t0e1mnested0p" "r\\\\n0" true undefined "|" 2 4 0 21 "a" "b" "1m" "x" "y" "0" "1" "called" "idx" undefined "called" "d" "e" "f" 3 "t" 1 "and" 1 false true "undefined" "undefined" false true true true true true true "comma" undefined 3 4 7 "t1e2mnested1p" "r\\\\n1" "elif" true undefined',
  'generators: 1 2 3 "i" 4 5 "sent"',
  "expressionInfo: 177 178",
  'sloppy: 2 "w" "function" 1 "function" "function" "object"',
  'async: 12 2 1 3 6 "1,2,3,4,2"',
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
  for (let n = 0; n <= 64; n++)
    lines.push(
      `s = "${Buffer.alloc(n, "x").toString()}"; acc += s.length; s = "${"é".repeat(n)}"; acc += s.length; s = "${"字".repeat(n)}"; acc += s.length;`,
    );
  for (const b of [7, 8, 14, 15, 16, 21, 22, 28, 29, 31, 32, 33, 52])
    for (const d of [-1, 0, 1]) lines.push(`acc += ${2 ** b + d} % 7; acc -= ${-(2 ** b) + d} % 5;`);
  for (let n = 1; n <= 24; n++) {
    lines.push(
      `function sw${n}(v) { switch (v) { ${Array.from({ length: n }, (_, i) => `case ${i * ((n % 3) + 1)}: return ${i};`).join(" ")} default: return -1; } } acc += sw${n}(${n - 1});`,
    );
    lines.push(
      `function ss${n}(v) { switch (v) { ${Array.from({ length: n }, (_, i) => `case "k${Buffer.alloc(i, "q").toString()}": return ${i};`).join(" ")} default: return -1; } } acc += ss${n}("k${Buffer.alloc(n - 1, "q").toString()}");`,
    );
    lines.push(
      `function p${n}(${Array.from({ length: n }, (_, i) => "a" + i).join(", ")}) { return arguments.length + a${n - 1}; } acc += p${n}(${Array.from({ length: n }, (_, i) => i).join(", ")});`,
    );
    lines.push(
      `class C${n} { ${Array.from({ length: n }, (_, i) => `f${i} = ${i}; #p${i} = ${i};`).join(" ")} sum() { return ${Array.from({ length: n }, (_, i) => `this.f${i} + this.#p${i}`).join(" + ")}; } } acc += new C${n}().sum();`,
    );
    lines.push(
      `acc += [${Array.from({ length: n }, (_, i) => i).join(", ")}].length + [${Array.from({ length: n }, (_, i) => i + 0.5).join(", ")}].length + [${Array.from({ length: n }, (_, i) => `"e${i}"`).join(", ")}].length;`,
    );
    lines.push(
      `acc += ${Array.from({ length: n }, (_, i) => i).reduceRight((inner, i) => `(v${i} => ${inner})(${i})`, Array.from({ length: n }, (_, i) => "v" + i).join(" + "))};`,
    ); // n nested arrows, the innermost capturing every parameter
  }
  for (let depth = 1; depth <= 12; depth++)
    lines.push(
      `acc += (function d${depth}_0() { let v0 = ${depth}; ${Array.from({ length: depth }, (_, i) => `return (function d${depth}_${i + 1}() { let v${i + 1} = v${i} + 1;`).join(" ")} return ${Array.from({ length: depth + 1 }, (_, i) => "v" + i).join(" + ")}; ${"})();".repeat(depth)} })();`,
    );
  lines.push("console.log(acc);");
  return lines.join("\n") + "\n";
}

// Source text in the forms a bundler would normalize away but that reach JSC as-is through vm.Script (and jsc/other
// embedders): a hashbang line, CRLF line endings, U+2028/U+2029 both as line terminators and inside literals, U+FEFF as
// whitespace, \u{...} escapes in identifiers, strings, templates and regular expressions (an identifier spelled with
// escapes and spelled literally is one binding), line continuations, HTML-like comments, and the sloppy-only lexical
// forms Bun's transpiler refuses: duplicate parameter names, legacy octal literals and octal string escapes. Also the
// strict-mode contrast to records.js's sloppy section (block-scoped function declarations, unmapped arguments,
// undefined this, eval's own scope), here rather than there because the bundler drops function-level "use strict"
// directives. Line and column bookkeeping for all of these ends up in the cached functions' positions.
function sourceFormsSource() {
  const LS = " ",
    PS = " ",
    ZWNBSP = "﻿";
  const lines = [
    "#!/usr/bin/env not-a-real-interpreter",
    "var out = [];",
    "var \\u{1d49c}\\u0061 = 'escaped astral';",
    "out.push(\u{1d49c}a === \\u{1d49c}a, '\\u{1F600}'.length, /\\u{1F600}/u.test('\u{1F600}'), `\\u{41}${'\\u0042'}\\x43`);",
    "var caf\\u00e9 = 1; out.push(café + caf\\u00e9);",
    `out.push('a${LS}b'.length, "c${PS}d".length, \`e${LS}f\`.length);`,
    `function acrossSeparators(x) {${LS}  var y = x + 1;${PS}  return y * 2;${LS}}`,
    "out.push(acrossSeparators(20), acrossSeparators.toString().length);",
    `out.push(${ZWNBSP}1 +${ZWNBSP}2${ZWNBSP});`,
    "out.push('line \\",
    "continued'.length, `template",
    "with a CRLF inside`.indexOf('\\r'), String.raw`raw",
    "CRLF`.length);",
    "<!-- an HTML-like comment, to the end of the line",
    "out.push('after html comment');",
    "--> also a comment when it starts a line",
    "function dup(a, a) { return a; }",
    "out.push(dup(1, 2), 010, 0o10, '\\101\\0'.length, '\\7'.charCodeAt(0));",
    "function positions() {\treturn (function inner() {\t\treturn new Error().stack !== undefined; })(); }",
    "out.push(positions());",
    "function strictForms(a) { 'use strict'; var r = []; { function inBlock() { return 'block'; } r.push(inBlock()); } r.push(typeof inBlock); arguments[0] = 'changed'; r.push(a, arguments[0], (function () { return typeof this; })()); eval('var leaked = 1;'); r.push(typeof leaked); return r; }",
    "out.push(...strictForms('orig'), ...(function sloppyTwin(a) { arguments[0] = 'changed'; eval('var leaked = 1;'); return [a, (function () { return typeof this; })(), typeof leaked]; })('orig'));",
    "console.log(JSON.stringify(out));",
  ];
  return lines.join("\r\n") + "\r\n";
}
const sourceFormsOutput = `[true,2,true,"ABC",2,3,3,3,42,65,3,14,-1,8,"after html comment",2,8,8,2,7,true,"block","undefined","orig","changed","undefined","undefined","changed","object","number"]`;

const esmOutput = `["main",3,1,"worker:2:2",true,"string"]`;

const allSource = [
  `require("./big.js");`,
  `require("./shapes.js");`,
  `require("./features.js");`,
  `require("./records.js");`,
  `const libs = [require("../../node_modules/lodash/lodash.js"), require("../../node_modules/acorn/dist/acorn.js"), require("../../node_modules/react-dom/cjs/react-dom.development.js")];`,
  `console.log("libs", libs.map(lib => typeof lib).join());`,
  ``,
].join("\n");
// big and shapes print synchronously while required; features then records print from promise callbacks, in that order.
const allOutput = [bigOutput, shapesOutput, "libs function,object,object", featuresOutput, recordsOutput].join("\n");

// Every dependency in test/package.json that bundles to one file whose text is the same on every platform (no inlined
// absolute paths, no per-platform optional packages), all in one payload.
const bundledTogether = [
  "@astrojs/node",
  "@azure/service-bus",
  "@bufbuild/protobuf",
  "@connectrpc/connect",
  "@connectrpc/connect-node",
  "@fastify/websocket",
  "@grpc/proto-loader",
  "@happy-dom/global-registrator",
  "@remix-run/node",
  "@remix-run/react",
  "@testing-library/react",
  "@vitest/coverage-v8",
  "acorn",
  "ansi-regex",
  "axios",
  "body-parser",
  "bun-plugin-yaml",
  "comlink",
  "commander",
  "detect-libc",
  "devalue",
  "es-module-lexer",
  "express",
  "fast-glob",
  "filenamify",
  "happy-dom",
  "hono",
  "http2-wrapper",
  "https-proxy-agent",
  "iconv-lite",
  "immutable",
  "isbot",
  "jest-extended",
  "jimp",
  "jsonwebtoken",
  "jws",
  "lodash",
  "mongodb",
  "msw",
  "mysql2",
  "nodemailer",
  "p-queue",
  "pg",
  "pg-connection-string",
  "pg-gateway",
  "pino-pretty",
  "postgres",
  "prompts",
  "react",
  "react-dom",
  "reflect-metadata",
  "sinon",
  "socket.io-adapter",
  "socket.io-client",
  "st",
  "string-width",
  "strip-ansi",
  "stripe",
  "superagent",
  "tsyringe",
  "tunnel",
  "uuid",
  "v8-heapsnapshot",
  "xml2js",
];
const librariesSource = bundledTogether
  .map(
    (lib, i) =>
      `try { globalThis.lib${i} = require(${JSON.stringify(lib)}); loaded++; } catch (e) { failed.push(${JSON.stringify(lib)} + ": " + e); }`,
  )
  .join("\n");
const librariesOutput = `${bundledTogether.length} libraries, failed: []`;

const corpusBuilds = [
  { name: "bun build --bytecode features.js", entry: "./features.js", args: [] as string[], output: featuresOutput },
  {
    name: "bun build --bytecode --minify features.js",
    entry: "./features.js",
    args: ["--minify"],
    output: featuresOutput,
  },
  { name: "bun build --bytecode records.js", entry: "./records.js", args: [] as string[], output: recordsOutput },
  {
    name: "bun build --bytecode --minify records.js",
    entry: "./records.js",
    args: ["--minify"],
    output: recordsOutput,
  },
  { name: "bun build --bytecode big.js", entry: "./big.js", args: [] as string[], output: bigOutput },
  { name: "bun build --bytecode shapes.js", entry: "./shapes.js", args: [] as string[], output: shapesOutput },
  // Everything above plus a few libraries in ONE payload: string, identifier-set and environment sharing across many
  // code blocks, and a multi-megabyte payload spanning hundreds of encoder pages.
  { name: "bun build --bytecode all.js", entry: "./all.js", args: [] as string[], output: allOutput },
  { name: "bun build --bytecode libraries.js", entry: "./libraries.js", args: [] as string[], output: librariesOutput },
  { name: "bun build --bytecode --minify all.js", entry: "./all.js", args: ["--minify"], output: allOutput },
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
const libraryBuilds = libraries.map(lib => ({
  name: `bun build --bytecode ${lib}`,
  entry: `../../node_modules/${lib}`,
  args: [] as string[],
}));
const bundlerBuilds = [...corpusBuilds, ...libraryBuilds];

// The generated inputs go next to the checked-in corpus rather than into a temp dir: the bundler writes each module's
// path relative to the cwd into its output, so the corpus directory has to be the same relative place on every machine.
// Same bytes every run; only written when missing or stale so a concurrent run never sees a half-written file.
function writeCorpusFile(name: string, contents: string) {
  const path = join(corpusDir, name);
  if (existsSync(path) && readFileSync(path, "utf8") === contents) return;
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, contents);
  renameSync(temp, path);
}
writeCorpusFile("big.js", bigSource());
writeCorpusFile("shapes.js", shapesSource());
writeCorpusFile("all.js", allSource);
writeCorpusFile(
  "libraries.js",
  `var loaded = 0, failed = [];\n${librariesSource}\nconsole.log(loaded + " libraries, failed: " + JSON.stringify(failed));\n`,
);

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
function fingerprint(name: string, bytecode: Uint8Array, isPayload = true) {
  const copy = new Uint8Array(bytecode);
  if (isPayload) {
    copy.fill(0, 0, 4);
    copy.fill(0, 8, 12);
  }
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
    outputs["vm.Script shapes.js"] = fingerprint(
      "vm.Script shapes.js",
      new vm.Script(shapesSource(), { filename: "shapes.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script records.js"] = fingerprint(
      "vm.Script records.js",
      new vm.Script(recordsSource, { filename: "records.js", produceCachedData: true }).cachedData!,
    );
    // A builtin (what `bun build --compile --bytecode` embeds for node:* / bun:* modules): @-intrinsics and the
    // builtin-executable entry, which user source never produces. Bun's own internal modules are not hashed here because
    // their source is per-OS (process.platform is inlined); the next test covers them.
    const builtin = internalModuleBytecode(builtinSource, "corpus:builtin");
    outputs["builtin corpus"] = fingerprint("builtin corpus", builtin.bytecode);
    outputs["builtin corpus strings"] = fingerprint("builtin corpus strings", builtin.strings, false); // the external string table --compile embeds beside it
    outputs["vm.SourceTextModule module.js"] = fingerprint(
      "vm.SourceTextModule module.js",
      new vm.SourceTextModule(moduleSource, { identifier: "module.js" }).createCachedData(),
    );
    outputs["vm.Script big.js"] = fingerprint(
      "vm.Script big.js",
      new vm.Script(bigSource(), { filename: "big.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script source-forms.js"] = fingerprint(
      "vm.Script source-forms.js",
      new vm.Script(sourceFormsSource(), { filename: "source-forms.js", produceCachedData: true }).cachedData!,
    );
    const librarySource = (lib: string) => readFileSync(join(corpusDir, "../../node_modules", lib), "utf8");
    outputs["vm.Script lodash.js"] = fingerprint(
      "vm.Script lodash.js",
      new vm.Script(librarySource("lodash/lodash.js"), { filename: "lodash.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script typescript.js"] = fingerprint(
      "vm.Script typescript.js",
      new vm.Script(librarySource("typescript/lib/typescript.js"), {
        filename: "typescript.js",
        produceCachedData: true,
      }).cachedData!,
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
          "bytes": 5304,
          "sha256": "6af9fa4a4a6181c7c78743ea807bd12de95a0772503872207de28c218e252167",
        },
        "builtin corpus strings": {
          "bytes": 1044,
          "sha256": "2a5d62fb4ca9d107e3a5bb2abe6a73f3c859a6f1a91c6c3d77653cb8c2053361",
        },
        "bun build --bytecode --minify all.js": {
          "js": "52c1e0868de8da5d8bf4b89d68afbd027f3c64fdce490cd46800674b0de3f0c1",
          "jsc": {
            "bytes": 1999232,
            "sha256": "a6043ef5e8aaae25c9581e6802fc2508f0b7b2fb0681be536768f9d09ef4cac6",
          },
        },
        "bun build --bytecode --minify features.js": {
          "js": "d49da0aa39824bf9eba2af5d3a010525ad14ca5c1cedc0d8adcfdd5f4984a0d0",
          "jsc": {
            "bytes": 46152,
            "sha256": "db36543ec2430a8cbdce13a6a980148f502e2c6b135cf95f62b6743c3fa30968",
          },
        },
        "bun build --bytecode --minify records.js": {
          "js": "889cbb2c9525ff69a2676a6e81d97bb87760bdee65178b836c9c1d6808ac7c6e",
          "jsc": {
            "bytes": 89144,
            "sha256": "3c3e86151fe78e6d56d7e7033dfa0e97b062af3b86d7ad75b723d91c77b11cba",
          },
        },
        "bun build --bytecode acorn/dist/acorn.mjs": {
          "js": "2ed858fa1b38a20673cee13a857ccdaedb9da0a325ebc47e81c4851de77eef3c",
          "jsc": {
            "bytes": 266176,
            "sha256": "9fec89f154cf2ae1593f52d49bb3ba6bae0634a56e4cc8fe76aabf6abb70bfe1",
          },
        },
        "bun build --bytecode all.js": {
          "js": "46d723ea07e5e2d8db673a51fec52b3248edcd3e216029f243d8172244f7cd2c",
          "jsc": {
            "bytes": 2178792,
            "sha256": "c5d1eaae5c4d198b1f8e0d768bb41502162081c75b67249032e66a2b95e26ec1",
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
          "js": "2ee211924620db96d6e99e9490bfe0ee60a3bc6b003f37940c5631e6eabc2c73",
          "jsc": {
            "bytes": 48048,
            "sha256": "457b0f1c9172a8964bf79d7b102076d410da468d4728e3731964884cbaecfa6e",
          },
        },
        "bun build --bytecode happy-dom/lib/index.js": {
          "js": "148f0d3e4baf485281725f859deb3e717a6da25a4a08de9af288d5ef54b6414b",
          "jsc": {
            "bytes": 2528840,
            "sha256": "d68b260282a74f545c15b5a3b812b69cb4e828972f85c5de60f8307b73c43e57",
          },
        },
        "bun build --bytecode immutable/dist/immutable.es.js": {
          "js": "c9a2ba9f6b6a662e6bdfd44128bc66284276f5eac2a8875adb4578472328dc9f",
          "jsc": {
            "bytes": 280016,
            "sha256": "2a99c33a2516e2d41187bc322ddd4523318530b51c60c3d9a8bd566d4f2929a1",
          },
        },
        "bun build --bytecode libraries.js": {
          "js": "e685164a8316f60b665bc3d47e42b4623cfe7385f87310e655478a50ecd8f959",
          "jsc": {
            "bytes": 23806352,
            "sha256": "5f23309532d868e1c985d568207c92b77a7f3974e5c6c3f37b21accf7d429327",
          },
        },
        "bun build --bytecode lodash/lodash.js": {
          "js": "13a679d20c26bbedc60746eaaf804ae5396086e330d25eed49b633d74c56771a",
          "jsc": {
            "bytes": 347608,
            "sha256": "cad0b454f93314b33e62d31613ec9b8cb70d7fff3fd3f5eec8e516ff1e76b697",
          },
        },
        "bun build --bytecode react-dom/cjs/react-dom.development.js": {
          "js": "e2cf34c8eb6f5952a33ca91e3949b28786349cf97ea3fbf0b3b8500dbccd4860",
          "jsc": {
            "bytes": 980080,
            "sha256": "32fa8492ad9fdf3ea31395756898d556df9dc6bdfbac9bba07bcafa748ab38ca",
          },
        },
        "bun build --bytecode records.js": {
          "js": "c87ea35df4ad6b2063402c9901ef4775a82f12594f280db76f50695f4b0eba13",
          "jsc": {
            "bytes": 91800,
            "sha256": "e58b77a8ed116cb6d48d82496d214eb11f8cc6b821049851b60c1f2fb27ebeea",
          },
        },
        "bun build --bytecode shapes.js": {
          "js": "dfcf0136de2c98f6a29d2c41477637879ccae98385a1bf30c666b85002bcae07",
          "jsc": {
            "bytes": 247400,
            "sha256": "762cefed8be322722d6b39d4e9be948eef87fb032b4bf4dbbc5da7c98e90ec7c",
          },
        },
        "bun build --bytecode svelte/compiler/index.js": {
          "js": "5ced9487e680d82a45548d0f509ecc5c931f06485a2d17bac56ddd60e3ede785",
          "jsc": {
            "bytes": 1996728,
            "sha256": "1e224f518c1be57eb53460723b34128ca4c310bbe75a7a1ea93a900e24c3db74",
          },
        },
        "bun build --bytecode undici/index.js": {
          "js": "d0bd3791e7c8f77a06814429d5d95cb26a06baaa3c135502bcd3e984310f1d2c",
          "jsc": {
            "bytes": 937000,
            "sha256": "d7cff4df84668b14987703bcd950a6753a574cf48e4372e4fe8779f747c0ed89",
          },
        },
        "vm.Script big.js": {
          "bytes": 168560,
          "sha256": "c18507143f6ed98ab9e3a462d88887d26720a30f2d10873172c2c7b428cdeac8",
        },
        "vm.Script features.js": {
          "bytes": 48104,
          "sha256": "ee8b73b9c923192eab9694d93ca3538852e2260609137801ee57fa5e744db0f6",
        },
        "vm.Script lodash.js": {
          "bytes": 354984,
          "sha256": "3507b5aefbce08874084f508846de833bf38d2176a0a7b584773dd49fe21d7c9",
        },
        "vm.Script records.js": {
          "bytes": 92928,
          "sha256": "82ee58ee4885a96f8e2b55f9716d7782914d7212957b44f2109b63d3372ffcf3",
        },
        "vm.Script shapes.js": {
          "bytes": 286632,
          "sha256": "3637efdaeea6761cda4d66ca154302e178c4820d143798507cec3f262826d6ef",
        },
        "vm.Script source-forms.js": {
          "bytes": 4976,
          "sha256": "01418094926f5c168db7a01da064308b376fe796a3d8c96aef0719dbe1db4081",
        },
        "vm.Script typescript.js": {
          "bytes": 12094104,
          "sha256": "953551a49ed6db7b5fce11b21382f11f3a0d0d4945507f5e38bf6a14ca724e8a",
        },
        "vm.SourceTextModule acorn.mjs": {
          "bytes": 264176,
          "sha256": "b39984469ff175c7b37e0255c217c8464fe9d564aa8f8da429e02ef0f05d7781",
        },
        "vm.SourceTextModule module.js": {
          "bytes": 9712,
          "sha256": "b864ddcfde36d03c8ddba5728ae2f3dde05e08e640dea1599b8915a515429517",
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
        import { internalModuleBytecode } from "bun:internal-for-testing";
        import { mkdirSync, readFileSync, writeFileSync } from "fs";
        import vm from "node:vm";
        for (let i = 0; i < 1000; i++) Symbol("s" + i); // symbol hash counter
        const wide = s => (s + "\u1234").slice(0, -1).split("\u1234").join("");
        globalThis.o = { [wide("classify")]: 1, [wide("literals")]: 2, [wide("ab")]: 3 }; // 16-bit atoms for corpus names
        const [entry, outdir, source] = process.argv.slice(2);
        const script = new vm.Script(readFileSync(source, "utf8"), { filename: "features.js" });
        script.runInNewContext({ console: { log() {} } }); // the corpus itself, parsed and run in this VM first
        mkdirSync(outdir, { recursive: true });
        writeFileSync(outdir + "/vm.cached", script.createCachedData()); // produced after running it
        const result = await Bun.build({ entrypoints: [entry], outdir, target: "bun", format: "cjs", bytecode: true });
        if (!result.success) throw new AggregateError(result.logs);
        const mask = b => { b = new Uint8Array(b); b.fill(0, 0, 4); b.fill(0, 8, 12); return b; }; // as fingerprint() does
        const sha = b => new Bun.CryptoHasher("sha256").update(b).digest("hex");
        const internalModules = {};
        for (let i = 0, m; (m = internalModuleBytecode(i)); i++) internalModules[m.name] = sha(mask(m.bytecode)) + " " + sha(m.strings);
        writeFileSync(outdir + "/internal-modules.json", JSON.stringify(internalModules));
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
    for (let i = 0, m; (m = internalModuleBytecode(i)); i++)
      internalModules[m.name] = hash(m.bytecode) + " " + fingerprint("", m.strings, false).sha256;
    expect(Object.keys(internalModules).length).toBeGreaterThan(100);
    expect(JSON.parse(readFileSync(join(String(dir), "api", "internal-modules.json"), "utf8"))).toEqual(
      internalModules,
    );

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

  // The shipping path: the corpus inside `bun build --compile --bytecode` executables, CJS and ESM, every module loaded
  // from the embedded bytecode (one "Cache hit" per module; the trailing miss is the runtime's own eval).
  for (const { name, entries, args, output, modules } of [
    { name: "features.js", entries: ["./features.js"], args: [], output: featuresOutput, modules: 1 },
    { name: "--minify records.js", entries: ["./records.js"], args: ["--minify"], output: recordsOutput, modules: 1 },
    { name: "--format=esm big.js", entries: ["./big.js"], args: ["--format=esm"], output: bigOutput, modules: 1 },
    {
      name: "--format=esm esm/main.js + worker",
      entries: ["./esm/main.js", "./esm/worker.js"],
      args: ["--format=esm"],
      output: esmOutput,
      modules: 2,
    },
    {
      name: "--format=esm --minify esm/main.js + worker",
      entries: ["./esm/main.js", "./esm/worker.js"],
      args: ["--format=esm", "--minify"],
      output: esmOutput,
      modules: 2,
    },
  ]) {
    test.concurrent(`\`bun build --compile --bytecode ${name}\` runs from the embedded bytecode`, async () => {
      using dir = tempDir("bytecode-portable-compile", {});
      const exe = join(String(dir), isWindows ? "app.exe" : "app");
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--bytecode", ...args, "--outfile", exe, ...entries],
        cwd: corpusDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error");
      expect(buildExit).toBe(0);
      await using proc = Bun.spawn({
        cmd: [exe],
        env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.match(/\[Disk Cache\] Cache hit for sourceCode/g)?.length).toBe(modules);
      expect(stdout).toBe(output + "\n");
      expect(exitCode).toBe(0);
    });
  }

  // A payload this build cannot use (written by an incompatible build, cut short, empty) must cost a parse, nothing more.
  // Byte 20 is the entry header's callee-save register count; changing any header byte also fails the header checksum.
  for (const [variant, spoil] of [
    ["a different build's header", (jsc: Buffer) => ((jsc[20] ^= 0xff), jsc)],
    ["truncated", (jsc: Buffer) => jsc.subarray(0, 200)],
    ["empty", (jsc: Buffer) => jsc.subarray(0, 0)],
  ] as const) {
    test.concurrent(`a .jsc that is ${variant} is a cache miss, not a crash`, async () => {
      using dir = tempDir("bytecode-portable-reject", {});
      const { jsc } = await bundle(String(dir), "./records.js", []);
      writeFileSync(join(String(dir), "records.js.jsc"), spoil(Buffer.from(jsc)));
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "records.js")],
        env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("Cache hit");
      expect(stderr).toContain("[Disk Cache] Cache miss for sourceCode");
      expect(stdout).toBe(recordsOutput + "\n");
      expect(exitCode).toBe(0);
    });
  }

  for (const [file, source, output] of [
    ["features.js", featuresSource, featuresOutput],
    ["records.js", recordsSource, recordsOutput],
    ["source-forms.js", sourceFormsSource(), sourceFormsOutput],
  ] as const) {
    test.concurrent(`vm.Script cachedData for ${file} is accepted and runs`, async () => {
      const { cachedData } = new vm.Script(source, { filename: file, produceCachedData: true });
      const script = new vm.Script(source, { filename: file, cachedData });
      expect(script.cachedDataRejected).toBe(false);
      const lines: string[] = [];
      const context = vm.createContext({ console: { log: (...args: unknown[]) => lines.push(args.join(" ")) } });
      await script.runInContext(context); // features.js and records.js end in the promise that prints their output
      expect(lines.join("\n")).toBe(output);
    });
  }
});
