import { internalModuleBytecode } from "bun:internal-for-testing";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import vm from "node:vm";
import { basename, join } from "path";

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
  const label = `\`bun build --bytecode ${[...args, entry].join(" ")}\``;
  await using proc = Bun.spawn({
    // Relative entry + fixed cwd: the unminified output names each module by its path relative to cwd.
    cmd: [bunExe(), "build", "--bytecode", "--target=bun", ...args, "--outdir", outdir, entry],
    cwd: corpusDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr, `${label} wrote to stderr`).toBe("");
  expect(exitCode, `${label} exit code`).toBe(0);
  const output = basename(entry).replace(/\.[cm]?js$/, ".js"); // the bundler names its output .js whatever the entry's extension
  expect(readdirSync(outdir).sort(), `${label} output files`).toEqual([output, output + ".jsc"]);
  const path = join(outdir, output);
  return { path, js: readFileSync(path), jsc: readFileSync(path + ".jsc") };
}

// Several tests read the same build: the snapshot test fingerprints it, the load test runs it, the reject tests spoil a
// copy. The first one to ask starts the build and the others share its result, so each entry is bundled once per run.
// Each build gets its own directory under one temp dir that lives as long as the file.
const buildsDir = tempDir("bytecode-portable", {});
afterAll(() => buildsDir[Symbol.dispose]());
const builds = new Map<string, ReturnType<typeof bundle>>();
function build({ name, entry, args }: { name: string; entry: string; args: readonly string[] }) {
  let pending = builds.get(name);
  if (!pending) builds.set(name, (pending = bundle(join(String(buildsDir), String(builds.size)), entry, args)));
  return pending;
}

// The payload starts with GenericCacheEntry { uint32 cacheVersion; ... }. cacheVersion is a hash of the WebKit version
// string, so it changes on every WebKit upgrade whether or not the format did; mask it so the snapshot only moves when
// the serialized bytes do.
function fingerprint(bytecode: Uint8Array, isPayload = true) {
  const copy = new Uint8Array(bytecode);
  if (isPayload) copy.fill(0, 0, 4);
  return { sha256: Bun.CryptoHasher.hash("sha256", copy, "hex"), bytes: copy.byteLength };
}

// node:vm prefixes the payload with an 8-byte checksum.
const vmFingerprint = (cachedData: Uint8Array) => fingerprint(cachedData.subarray(8));

describe("bytecode cache portability", () => {
  test("encoder output is identical on every platform", async () => {
    // The bundler builds are separate processes: start them all, then encode the in-process cases while they run.
    const bundled = Promise.all(bundlerBuilds.map(build));
    const outputs: Record<string, unknown> = {};
    // Program and module code blocks straight from the encoder, without the bundler in between.
    outputs["vm.Script features.js"] = vmFingerprint(
      new vm.Script(featuresSource, { filename: "features.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script shapes.js"] = vmFingerprint(
      new vm.Script(shapesSource(), { filename: "shapes.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script records.js"] = vmFingerprint(
      new vm.Script(recordsSource, { filename: "records.js", produceCachedData: true }).cachedData!,
    );
    // A builtin (what `bun build --compile --bytecode` embeds for node:* / bun:* modules): @-intrinsics and the
    // builtin-executable entry, which user source never produces. Bun's own internal modules are not hashed here because
    // their source is per-OS (process.platform is inlined); the next test covers them.
    const builtin = internalModuleBytecode(builtinSource, "corpus:builtin");
    outputs["builtin corpus"] = fingerprint(builtin.bytecode);
    outputs["builtin corpus strings"] = fingerprint(builtin.strings, false); // the external string table --compile embeds beside it
    outputs["vm.SourceTextModule module.js"] = vmFingerprint(
      (new vm.SourceTextModule(moduleSource, { identifier: "module.js" }) as any).createCachedData(),
    );
    outputs["vm.Script big.js"] = vmFingerprint(
      new vm.Script(bigSource(), { filename: "big.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script source-forms.js"] = vmFingerprint(
      new vm.Script(sourceFormsSource(), { filename: "source-forms.js", produceCachedData: true }).cachedData!,
    );
    const librarySource = (lib: string) => readFileSync(join(corpusDir, "../../node_modules", lib), "utf8");
    outputs["vm.Script lodash.js"] = vmFingerprint(
      new vm.Script(librarySource("lodash/lodash.js"), { filename: "lodash.js", produceCachedData: true }).cachedData!,
    );
    outputs["vm.Script typescript.js"] = vmFingerprint(
      new vm.Script(librarySource("typescript/lib/typescript.js"), {
        filename: "typescript.js",
        produceCachedData: true,
      }).cachedData!,
    );
    outputs["vm.SourceTextModule acorn.mjs"] = vmFingerprint(
      (
        new vm.SourceTextModule(librarySource("acorn/dist/acorn.mjs"), { identifier: "acorn.mjs" }) as any
      ).createCachedData(),
    );
    for (const [i, { name }] of bundlerBuilds.entries()) {
      const { js, jsc } = (await bundled)[i];
      // If `js` differs between platforms the bundler is at fault, not the bytecode format.
      // The file ends with a 24-byte footer whose checksum covers cacheVersion, so hash only the payload.
      outputs[name] = { js: Bun.CryptoHasher.hash("sha256", js, "hex"), jsc: fingerprint(jsc.subarray(0, -24)) };
    }
    expectOutputs(outputs);
  });

  // Last moved on every platform at once by JavaScriptCore's parser and bytecode generator (parser/Parser.cpp,
  // bytecompiler/NodesCodegen.cpp): a name, a spread, `new X(args)` and a call of a name record the position where the
  // token starts, no longer the one where it ends. 26 of the 30 hashes and 6 sizes: the positions of a code block are
  // stored as distances, so a size follows them.
  function expectOutputs(outputs: Record<string, unknown>) {
    expect(
      outputs,
      "serialized bytecode differs from the snapshot — read the comment at the top of this file before updating it",
    ).toMatchInlineSnapshot(`
      {
        "builtin corpus": {
          "bytes": 5120,
          "sha256": "4b17080e2ccca33359be4d80ef0475078148fa2693a45b963f08376680a91da7",
        },
        "builtin corpus strings": {
          "bytes": 1044,
          "sha256": "2a5d62fb4ca9d107e3a5bb2abe6a73f3c859a6f1a91c6c3d77653cb8c2053361",
        },
        "bun build --bytecode --minify all.js": {
          "js": "918f169d30d5a87cc6fde0abb5827ea858fde09e1df59a30f24870eba2e67e9f",
          "jsc": {
            "bytes": 1731912,
            "sha256": "fadbe0319483c9fbb1c4a5c59078e7a972d4af99108fff1983a2d2c1698cc8ea",
          },
        },
        "bun build --bytecode --minify features.js": {
          "js": "01891b9edc3e3f1e7cff44bd90d7d00543ddd64bd730cc4d111ad629436fb671",
          "jsc": {
            "bytes": 42528,
            "sha256": "6296b3438294dc0aa9da0a63ff46dc0b8cf41328971c23d5701749e3e1dee6e3",
          },
        },
        "bun build --bytecode --minify records.js": {
          "js": "eba33198824cc48f618cb7be37d1321a9fa2daa7b3a1dee17bc67e9e81fc5a62",
          "jsc": {
            "bytes": 81040,
            "sha256": "b3cfece2b9eacb6e03ab9591710fb11368f394731d2492e832a22347c399ba98",
          },
        },
        "bun build --bytecode acorn/dist/acorn.mjs": {
          "js": "aa22cb20382fa5d66ff2ddd90817c0899f82b346bdd1da87dc9e193d203a0ce9",
          "jsc": {
            "bytes": 236672,
            "sha256": "927e4131abc5990a4f41954474d5547ab88437d7bf1164313192469509472d9f",
          },
        },
        "bun build --bytecode all.js": {
          "js": "a55ff68728c0a42514e3b9de528f1131644774f16aa9fe37d365245b164e8b31",
          "jsc": {
            "bytes": 1876328,
            "sha256": "46f7bcf15996359994321120685758a7339f190ee7d68d0c9da8afb7a1b203c2",
          },
        },
        "bun build --bytecode big.js": {
          "js": "df5367354d3dbd2b81114585fb2a21d058910c869ece4404ef015c0efaf5c689",
          "jsc": {
            "bytes": 146384,
            "sha256": "31048354c10ec3f8a430db3b410c8e04bd9e9ca020de4f34da66ee8739bbfe85",
          },
        },
        "bun build --bytecode features.js": {
          "js": "fab10827f6eeeee6927c7678ff66d6a40806be1b347138f4f4c93dc3f479c5f5",
          "jsc": {
            "bytes": 44424,
            "sha256": "47b1deb23d7ab5f79055d76232a6661f0380ac95b1c3892f11435d6227cc62aa",
          },
        },
        "bun build --bytecode happy-dom/lib/index.js": {
          "js": "1415a67d0da987f3bb7fc68ca431e222b3898fa14be8af88e2845813c4120f43",
          "jsc": {
            "bytes": 2218712,
            "sha256": "cc861ba226ccff1356bf528ab6799d5c10ccff409f9ce41e9d5e45316a483d45",
          },
        },
        "bun build --bytecode immutable/dist/immutable.es.js": {
          "js": "d011b6c5105dad96f17aaf541c848b8d2be1b2e65a1de050112380352979bb6b",
          "jsc": {
            "bytes": 239072,
            "sha256": "5712bbcfdfb1b506efd25e79216d4a46894292331817e5216edbed285f5ccca5",
          },
        },
        "bun build --bytecode libraries.js": {
          "js": "efb37dc3389e11bf3b88e5b53164a56d20f9640d37c019182f92e391cb0bf3b2",
          "jsc": {
            "bytes": 21179120,
            "sha256": "528c93d13a9ecab14a75bb57240e54dd67ae7c37fbe8237594a1a92506f9e049",
          },
        },
        "bun build --bytecode lodash/lodash.js": {
          "js": "9951d06da1bf94c69dece1b23f304c1cbf4018b894e398ac5ea10f35b5600187",
          "jsc": {
            "bytes": 303600,
            "sha256": "52835c732a6a3b3ab3a969c7be48ac6d456eb4702162fb1b7b9a64a8c86e9658",
          },
        },
        "bun build --bytecode react-dom/cjs/react-dom.development.js": {
          "js": "3392a38ccef2f1bb7b1c8c8cbfc8111b45f6cf6f8dec3c72a99f13a6568fd5a1",
          "jsc": {
            "bytes": 829872,
            "sha256": "a0cea83b214c7021d356574dc0eba5962a262bd0b77fb9b1d1b1b49c593b196d",
          },
        },
        "bun build --bytecode records.js": {
          "js": "7f7481845388ff377c5fbc630445cc90f235ba32f673d2c3cec030073c46b762",
          "jsc": {
            "bytes": 83848,
            "sha256": "5f9ba07231fe6c45d19cee3ae536b793acf0146f2104928f272ad8c965f7b7ba",
          },
        },
        "bun build --bytecode shapes.js": {
          "js": "dfcf0136de2c98f6a29d2c41477637879ccae98385a1bf30c666b85002bcae07",
          "jsc": {
            "bytes": 214224,
            "sha256": "1eef14a3470fecb006898fa5dca4d3128b6ccf3d7c388b2c9532d9b1674c7cd7",
          },
        },
        "bun build --bytecode svelte/compiler/index.js": {
          "js": "17e7431a6f28a4b6b5d356fc815b0876ebd9613ae6c25a98dc4c5560004341ce",
          "jsc": {
            "bytes": 1820264,
            "sha256": "74c58da217f8fbd9f5a6f168783fa311f1ccf87b92810ce3010fa9aa4498922b",
          },
        },
        "bun build --bytecode undici/index.js": {
          "js": "e1c4f1494711ecaae57a6d63dfb8ac6096629582f55cc42530ff5a156b70c9de",
          "jsc": {
            "bytes": 852224,
            "sha256": "2d7a14fdc0e0adb3ab8dea678d680a972d95fe6c80a203a273e1a0679a657e17",
          },
        },
        "vm.Script big.js": {
          "bytes": 169496,
          "sha256": "020c2cfcc7c90658326db79b42297204a50e3d8106bbe02223cee2a49475f1a7",
        },
        "vm.Script features.js": {
          "bytes": 45224,
          "sha256": "4cad2c6b0ce88f2d592fc2ad09530f60128e3a212ff9a4694064faad8c305c65",
        },
        "vm.Script lodash.js": {
          "bytes": 342896,
          "sha256": "d68782d08f891be9b1e8e6571f227dcb2ec4b45e0a72e541bb21d43e88dd53b5",
        },
        "vm.Script records.js": {
          "bytes": 86616,
          "sha256": "61027c427edc981e65340b70384a9a0323ed454584de5ec9d4b2c830f70b33c7",
        },
        "vm.Script shapes.js": {
          "bytes": 257488,
          "sha256": "deadc7766e4c5e0854a552eb00eb7e6a484843a5878aa9bf96feb7f0235ab98f",
        },
        "vm.Script source-forms.js": {
          "bytes": 4712,
          "sha256": "4d2c8f2bd1ea9a19371877a8d69e400b3afb07703e991319ad6b0a52b903d26d",
        },
        "vm.Script typescript.js": {
          "bytes": 11326536,
          "sha256": "0c17dfc8977bf5e713baeb0c06b10c685f251a745d1493ad0f3a9fc3798d09fd",
        },
        "vm.SourceTextModule acorn.mjs": {
          "bytes": 255184,
          "sha256": "23d298b71a419fede6851047a913c7903b2569309bc6ad8f053a681a5e994e4f",
        },
        "vm.SourceTextModule module.js": {
          "bytes": 9104,
          "sha256": "79a1608b7e59c51a7179bbd7859e4613f73bcf4ead05f3175fe78e162b6c5081",
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
        const mask = b => { b = new Uint8Array(b); b.fill(0, 0, 4); return b; }; // as fingerprint() does
        const sha = b => new Bun.CryptoHasher("sha256").update(b).digest("hex");
        const internalModules = {};
        for (let i = 0, m; (m = internalModuleBytecode(i)); i++) internalModules[m.name] = sha(mask(m.bytecode)) + " " + sha(m.strings);
        writeFileSync(outdir + "/internal-modules.json", JSON.stringify(internalModules));
      `,
    });
    const { entry, args } = bundlerBuilds[0];
    const hash = (bytes: Uint8Array) => fingerprint(bytes).sha256;
    const conditions: Record<string, Record<string, string>> = {
      "collectContinuously": { BUN_JSC_collectContinuously: "1" },
      "useSourceProviderCache=0": { BUN_JSC_useSourceProviderCache: "0" },
      "gcMaxHeapSize=64KB": { BUN_JSC_gcMaxHeapSize: "65536" },
    };
    // Start every child first; this process encodes its own internal modules while they run.
    const reference = build(bundlerBuilds[0]);
    const conditioned = Promise.all(
      Object.entries(conditions).map(async ([condition, env]) => {
        const { jsc } = await bundle(join(String(dir), condition), entry, args, { ...bunEnv, ...env });
        return [condition, hash(jsc)] as const;
      }),
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "api.js"), entry, join(String(dir), "api"), join(corpusDir, "features.js")],
      cwd: corpusDir, // as bundle() does, so module path comments in the output agree
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const apiRun = Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Every one of Bun's internal modules as builtin bytecode, in this process and in the busy one: same bytes.
    const internalModules: Record<string, string> = {};
    for (let i = 0, m; (m = internalModuleBytecode(i)); i++)
      internalModules[m.name] = hash(m.bytecode) + " " + fingerprint(m.strings, false).sha256;
    const vmExpected = hash(
      new vm.Script(featuresSource, { filename: "features.js", produceCachedData: true }).cachedData!,
    );

    const [{ jsc: referenceJsc }, conditionHashes, [, stderr, exitCode]] = await Promise.all([
      reference,
      conditioned,
      apiRun,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const expected = hash(referenceJsc);
    const results: Record<string, string> = Object.fromEntries(conditionHashes);
    results["Bun.build() after running other JS"] = hash(readFileSync(join(String(dir), "api", "features.js.jsc")));
    expect(results).toEqual(Object.fromEntries(Object.keys(results).map(k => [k, expected])));

    expect(Object.keys(internalModules).length).toBeGreaterThan(100);
    expect(JSON.parse(readFileSync(join(String(dir), "api", "internal-modules.json"), "utf8"))).toEqual(
      internalModules,
    );

    expect({
      "vm.Script#createCachedData() after running it, in a busy VM": hash(
        readFileSync(join(String(dir), "api", "vm.cached")),
      ),
    }).toEqual({ "vm.Script#createCachedData() after running it, in a busy VM": vmExpected });
  });

  // Identical bytes only help if this platform also decodes what it encodes.
  for (const corpusBuild of corpusBuilds) {
    test.concurrent(`output of \`${corpusBuild.name}\` loads from the cache`, async () => {
      const { path } = await build(corpusBuild);
      await using proc = Bun.spawn({
        cmd: [bunExe(), path],
        env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toStartWith("[Disk Cache] Cache hit for sourceCode");
      expect(stdout).toBe(corpusBuild.output + "\n");
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
      await using compile = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--bytecode", ...args, "--outfile", exe, ...entries],
        cwd: corpusDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, compileStderr, compileExit] = await Promise.all([
        compile.stdout.text(),
        compile.stderr.text(),
        compile.exited,
      ]);
      expect(compileStderr).toBe("");
      expect(compileExit).toBe(0);
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
  // Bytes 0..3 are the entry header's cache version (GenericCacheEntry { cacheVersion; tag; reservedCalleeLocals }).
  const recordsBuild = corpusBuilds.find(({ entry, args }) => entry === "./records.js" && args.length === 0)!;
  for (const [variant, spoil] of [
    ["a different build's header", (jsc: Buffer) => ((jsc[1] ^= 0xff), jsc)],
    ["truncated", (jsc: Buffer) => jsc.subarray(0, 200)],
    ["empty", (jsc: Buffer) => jsc.subarray(0, 0)],
  ] as const) {
    test.concurrent(`a .jsc that is ${variant} is a cache miss, not a crash`, async () => {
      using dir = tempDir("bytecode-portable-reject", {});
      const { js, jsc } = await build(recordsBuild);
      writeFileSync(join(String(dir), "records.js"), js);
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
