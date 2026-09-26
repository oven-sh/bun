import { bytecodeOrderNames } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isDebug, isLinux, isMacOS, isMusl, isPosix, isWindows, tempDir } from "harness";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { isAbsolute, join, sep } from "path";

describe("Bun.build compile", () => {
  test("compile with current platform target string", async () => {
    using dir = tempDir("build-compile-target", {
      "app.js": `console.log("Cross-compiled app");`,
    });

    const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
    const arch = isArm64 ? "aarch64" : "x64";
    const musl = isMusl ? "-musl" : "";
    const target = `bun-${os}-${arch}${musl}` as any;
    const outdir = join(dir + "", "out");

    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      outdir,
      compile: {
        target: target,
        outfile: "app-cross",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-cross.exe" : "app-cross");

    const exists = await Bun.file(result.outputs[0].path).exists();

    // Verify that we do write it to the outdir.
    expect(result.outputs[0].path.replaceAll("\\", "/")).toStartWith(outdir.replaceAll("\\", "/"));
    expect(exists).toBe(true);
  });

  // The executable's embedded bytecode is mapped for the life of the process, so decoded instruction streams alias it
  // instead of being copied into private memory. The same bundle run from an on-disk .jsc, whose bytes are an owned buffer
  // the instruction streams are copied out of, is the control.
  test.skipIf(!isLinux)(
    "bytecode from a compiled executable is not copied into private memory",
    async () => {
      const body = Array.from(
        { length: 24 },
        (_, j) => `s = (s * ${j + 3} + a) ^ (b + ${j}); if (s & ${1 << j % 20}) s = s - ${j} | 0; o.p${j} = s;`,
      ).join(" ");
      const functions = Array.from(
        { length: 4000 },
        (_, i) => `export function f${i}(a, b) { let s = ${i}; const o = {}; ${body} return [s, ${i}, o]; }`,
      ).join("\n");
      using dir = tempDir("build-compile-bytecode-rss", {
        "funcs.js": functions,
        "app.js": `import * as m from "./funcs.js";
let n = 0;
for (const k in m) n += m[k](2, 3)[1] & 1;
const smaps = require("fs").readFileSync("/proc/self/smaps_rollup", "utf8");
const anon = Number(/Anonymous: +([0-9]+) kB/.exec(smaps)[1]);
console.log(JSON.stringify({ n, anonKB: anon }));`,
      });
      const outfile = join(dir + "", "app");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile },
        bytecode: true,
        format: "cjs",
        target: "bun",
      });
      expect(result.success).toBe(true);

      // The same program as `app.js` + `app.js.jsc` on disk: that bytecode is read into an owned buffer and its instruction
      // streams are copied out of it, which is the private memory the executable's mapped payload never allocates.
      const ondisk = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        outdir: join(dir + "", "out"),
        bytecode: true,
        format: "cjs",
        target: "bun",
      });
      expect(ondisk.success).toBe(true);

      const run = async (cmd: string[]) => {
        await using proc = Bun.spawn({
          cmd,
          cwd: dir + "",
          env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // Both runs execute the bundle from its bytecode, not from a parse, and print nothing else.
        const lines = stderr.split("\n").filter(Boolean);
        expect(lines.filter(l => !l.startsWith("[Disk Cache] "))).toEqual([]);
        expect(lines).toContain("[Disk Cache] Cache hit for sourceCode");
        expect(stdout).toContain("anonKB");
        expect(exitCode).toBe(0);
        return JSON.parse(stdout.trim()) as { n: number; anonKB: number };
      };
      const aliased = await run([outfile]);
      const copied = await run([bunExe(), join(dir + "", "out", "app.js")]);
      expect(aliased.n).toBe(2000);
      expect(copied.n).toBe(2000);
      // The on-disk run also holds app.js and app.js.jsc themselves in owned buffers; that much is not copying.
      const heldKB =
        (statSync(join(dir + "", "out", "app.js")).size + statSync(join(dir + "", "out", "app.js.jsc")).size) / 1024;
      // 4000 decoded functions carry ~11 MB of instruction stream + expression info; copied, that is anonymous memory the aliasing run never allocates.
      expect(copied.anonKB - heldKB - aliased.anonKB).toBeGreaterThan(4096);
    },
    60_000,
  );

  // BUN_BYTECODE_ORDER_OUT records which functions, strings and modules a run read out of the embedded bytecode;
  // --bytecode-order lays the next build's bytecode out by it: one payload for every chunk, what the run read first.
  // The program must not be able to tell, whatever it loads and calls, and in whatever order.
  describe("--compile --bytecode laid out by an order file", () => {
    const moduleNames = ["a", "b", "c", "d", "e", "f"];
    const files: Record<string, string> = {
      // argv: module names in the order to import them; each is asked for `first()` before `second()` unless "rev".
      "app.js": `
        import { shared } from "./shared.js";
        import { bytecodeOrderStats } from "bun:jsc";
        const load = { ${moduleNames.map(name => `${name}: () => import("./${name}.js")`).join(", ")} };
        const out = [shared("app")];
        const reversed = process.argv.includes("rev");
        for (const name of process.argv.slice(2).filter(arg => arg in load)) {
          const mod = await load[name]();
          out.push(...(reversed ? [mod.second(3), mod.first(2)] : [mod.first(2), mod.second(3)]));
        }
        console.log(out.join(" "));
        if (process.argv.includes("stats")) console.error("stats " + JSON.stringify(bytecodeOrderStats()));
      `,
      "shared.js": `
        export function shared(tag) { const twice = text => text + text; return twice(tag).toUpperCase(); }
        export class Unused { #field = "a private field"; method() { return () => this.#field; } }
      `,
    };
    for (const name of moduleNames)
      files[`${name}.js`] = `
        import { shared } from "./shared.js";
        export function first(n) { const pick = list => list.map(x => x * n).join("${name}"); return pick([1, 2, 3]); }
        export function second(n) { return [shared("${name}"), /${name}+/u.source, \`\${n}-${name}\`].join("/"); }
        export function never${name.toUpperCase()}(text) { return [...text].map(c => c.charCodeAt(0).toString(16)); }
        // (Order files name code by its shape: give every module its own.)
        export const shape = [${moduleNames
          .slice(0, moduleNames.indexOf(name) + 1)
          .map(n => `"${n}"`)
          .join(", ")}];
      `;
    const exe = (name: string) => (isWindows ? name + ".exe" : name);
    const buildArgs = ["--compile", "--bytecode", "--splitting", "--format=esm", "--minify", "app.js"];
    let dir: ReturnType<typeof tempDir>;
    const cwd = () => dir + "";
    afterAll(() => dir?.[Symbol.dispose]());

    async function compile(outfile: string, args: string[], env: Record<string, string> = {}, stdin?: string) {
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", ...buildArgs, ...args, "--outfile", outfile],
        env: { ...bunEnv, ...env },
        cwd: cwd(),
        stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      return { stderr, exitCode };
    }
    // JSC says so on stderr when it takes a module's code from the embedded bytecode.
    async function run(outfile: string, argv: string[], env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [join(cwd(), outfile), ...argv],
        env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1", ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, cacheHits: stderr.split("\n").filter(line => line.includes("Cache hit")).length, exitCode };
    }
    // `Offsets.flags` in the trailer of the embedded module graph; bit 13 = all bytecode is one linked payload.
    function hasLinkedPayload(outfile: string) {
      const file = readFileSync(isAbsolute(outfile) ? outfile : join(cwd(), outfile));
      const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined, "latin1");
      return (file.readUInt32LE(trailer - 4) & (1 << 13)) !== 0;
    }
    // The ordered build's counterpart of compile/splitting/StartupModulesPrecedeLazyChunks (bundler_compile_splitting):
    // where each module's bytecode starts in the linked payload, and where the payload's regions end (heads of the
    // modules the recorded run evaluated or did not know, the bodies it decoded, (reserved), heads of the modules it
    // knew and did not evaluate, all other bodies, expression info).
    function linkedLayout(outfile: string) {
      const file = readFileSync(isAbsolute(outfile) ? outfile : join(cwd(), outfile));
      const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined, "latin1");
      // `Offsets { byte_count: usize, modules_ptr: StringPointer, entry_point_id: u32, compile_exec_argv_ptr: StringPointer, flags: u32 }`
      const offsets = trailer - 32;
      const base = offsets - Number(file.readBigUInt64LE(offsets));
      const modules = { offset: file.readUInt32LE(offsets + 8), length: file.readUInt32LE(offsets + 12) };
      const flags = file.readUInt32LE(offsets + 28);
      const u32 = (at: number) => file.readUInt32LE(base + at);
      const count = modules.length / 52;
      // Records chained after the module table, in `Flags` bit order.
      let at = modules.offset + modules.length;
      if (flags & (1 << 5)) at += count * 4; // source hashes
      if (flags & (1 << 6)) at += 4 + u32(at) * 12; // builtin bytecode
      if (flags & (1 << 7)) at += 8; // bytecode string table
      if (flags & (1 << 8)) at += 4; // startup module count
      if (flags & (1 << 9)) at += 8; // module-info string table
      if (flags & (1 << 11)) at += 12 + u32(at + 8) * 4; // prelinked module graph
      if (flags & (1 << 12)) at += 8; // runtime options
      expect(flags & (1 << 13), "Flags::HAS_LINKED_BYTECODE_PAYLOAD").not.toBe(0);
      const payload = { offset: u32(at), length: u32(at + 4) };
      const regionEnds = [0, 1, 2, 3, 4, 5].map(region => u32(at + 8 + region * 4));
      // `CompiledModuleGraphFile`: name, contents, sourcemap, bytecode, module_info, bytecode_origin_path (StringPointer
      // each), then 4 bytes. Chunk names are hashed, so identify them by their source text.
      const entry: Record<string, number> = {};
      for (let i = 0; i < count; i++) {
        const record = base + modules.offset + i * 52;
        const contents = { offset: file.readUInt32LE(record + 8), length: file.readUInt32LE(record + 12) };
        const bytecode = { offset: file.readUInt32LE(record + 24), length: file.readUInt32LE(record + 28) };
        expect(bytecode.offset + bytecode.length, `module ${i}'s bytecode runs to the end of the payload`).toBe(
          payload.offset + payload.length,
        );
        const source = file.toString("latin1", base + contents.offset, base + contents.offset + contents.length);
        for (const name of moduleNames)
          if (source.includes(`/${name}+/u`)) entry[name] = bytecode.offset - payload.offset;
        if (source.includes(`"rev"`)) entry.app = bytecode.offset - payload.offset;
      }
      return { payloadLength: payload.length, regionEnds, entry, recordAt: base + at };
    }

    // One digest per module over ALL the code its bytecode holds, called or not; the entry point's line names the executable.
    async function digests(outfile: string) {
      const out = join(cwd(), outfile + ".digest");
      expect((await run(outfile, [], { BUN_BYTECODE_DIGEST_OUT: out })).exitCode).toBe(0);
      return (await Bun.file(out).text()).replaceAll(outfile, "<entry>");
    }

    // What the app prints for "stats": bun:jsc's bytecodeOrderStats() at the end of the run.
    async function stats(outfile: string, argv: string[], env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [join(cwd(), outfile), ...argv, "stats"],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = stderr.split("\n").find(line => line.startsWith("stats "));
      expect({ stdout: stdout.length > 0, stats: line !== undefined, exitCode }).toEqual({
        stdout: true,
        stats: true,
        exitCode: 0,
      });
      return JSON.parse(line!.slice("stats ".length));
    }

    // The recorded run imports a, b, c (never d, e, f) and calls first() before second().
    const recordedArgv = ["a", "b", "c"];
    // An order file names code by a hash of its syntax tree (src/js_parser/function_identities.rs), computed from the text
    // JavaScriptCore is given; bytecodeOrderNames() is that, as "M <name>" and "<start> <kind> <name>" lines.
    describe("what an order file calls code", () => {
      const namesOf = (text: string, kind: "module" | "script" | "builtin" = "module", chunkPaths: string[] = []) => {
        const names = bytecodeOrderNames(text, kind, chunkPaths.join("\n"));
        expect(names).not.toBeNull();
        return names!.trimEnd().split("\n");
      };
      // Without where they start.
      const functionsOf = (text: string, kind: "module" | "script" | "builtin" = "module") =>
        namesOf(text, kind)
          .filter(line => !line.startsWith("M "))
          .map(line => line.split(" ").slice(1).join(" "))
          .sort();
      const minified = async (source: string) => {
        using dir = tempDir("bytecode-order-minified", { "entry.js": source });
        const built = await Bun.build({
          entrypoints: [join(String(dir), "entry.js")],
          target: "bun",
          minify: { identifiers: true, whitespace: true },
        });
        expect(built.success).toBe(true);
        return await built.outputs[0].text();
      };

      // What has to hold is that two builds that minify alike agree, whatever names the minifier came up with: it gives
      // one name to bindings of scopes next to each other, and names labels and private names apart from bindings.
      test("a function keeps its name when the minifier picks other names", async () => {
        const common = `
          function spans(list) {
            let total = 0;
            for (const first of list) { total += first; }
            for (const second of list) { total -= second / 2; }
            { let inner = total, other = inner * 2; total = other - inner; }
            outer: for (const row of [list, list]) { for (const cell of row) { if (cell > 1) continue outer; total += cell; } }
            return [1].map(only => only + total)[0];
          }
          class Counter { #count = 1; #step = 2; next() { return (this.#count += this.#step); } peek() { return this.#count; } }
          console.log(spans([1, 2]), new Counter().next(), new Counter().peek());
        `;
        // Never called. A minifier picks names out of the characters the text uses the most, and this changes which
        // those are, and which bindings and private names are used the most.
        const busy = `class Busy { #zq = 1; #jx = 2; busy(p0, p1, p2, p3) { return ${[3, 2, 1, 0]
          .map((p, i) =>
            Array(40 * (4 - i))
              .fill(`p${p}.zzqzzqzzq.jjxjjxjjx + this.#jx`)
              .join(" + "),
          )
          .join(" + ")} + this.#zq; } }\nconsole.log(typeof Busy);`;
        const [few, many] = await Promise.all([minified(common), minified(common + busy)]);
        const spansOf = (text: string) => text.slice(text.indexOf("let "), text.indexOf("continue"));
        expect(spansOf(few).length).toBeGreaterThan(40);
        expect(spansOf(many)).not.toBe(spansOf(few));
        expect(functionsOf(few).length).toBeGreaterThanOrEqual(6);
        expect(functionsOf(many)).toEqual(expect.arrayContaining(functionsOf(few)));
      });

      test("which binding is used where is part of a name, what the bindings are called is not", () => {
        const sum = functionsOf("export const f = function (p, q) { return p + q; };");
        expect(functionsOf("export const f = function (of, async) { return of + async; };")).toEqual(sum);
        expect(functionsOf("export const f = function (p, q) { return p + p; };")).not.toEqual(sum);
        // A binding of the function around it, by which one it is there.
        const captured = (name: string) => functionsOf(`export function outer(a, b) { return () => ${name}; }`);
        expect(captured("a")).not.toEqual(captured("b"));
        // What no function around it declares: the module's by the order it is mentioned in, anything else by name.
        const free = (body: string) => functionsOf(`const one = 1, two = 2; export const f = () => ${body};`);
        expect(free("one")).toEqual(free("two"));
        expect(free("[one, two, one]")).not.toEqual(free("[one, two, two]"));
        expect(free("Math")).not.toEqual(free("JSON"));
        // A label is not a binding; an optional chain is where it starts.
        expect(functionsOf("export function f(a) { a: for (;;) break a; }")).toEqual(
          functionsOf("export function f(a) { b: for (;;) break b; }"),
        );
        expect(functionsOf("export const f = a => a?.b.c;")).not.toEqual(functionsOf("export const f = a => a?.b?.c;"));
      });

      // A program stamps itself with its version and the day it was built wherever it says them, and a build writes the
      // paths of its chunks, which are hashes of their contents, as strings.
      test("what a string says is not part of a name, the name of a property is", () => {
        const stamped = (version: string, property: string) =>
          functionsOf(
            `export function f(p) { return [p + "${version}".length, \`built ${version}\`, { ${property}: p }.${property}, p["${property}"]]; }`,
          );
        expect(stamped("2.0.1", "value")).toEqual(stamped("1.0.0", "value"));
        expect(stamped("1.0.0", "other")).not.toEqual(stamped("1.0.0", "value"));
      });

      test("an edit renames the function it is in and the functions around that, and nothing else", () => {
        const source = (edit: string) => `
          export function outer(n) {
            class A { x = n + 1; static y = () => n; }
            const t = \`v\${[n].map(x => x + 1)}\`;
            function inner(m) { return m * 2${edit}; }
            return [new A().x, t, inner(n)];
          }
          export function other(k) { return k - 1; }
        `;
        const [before, after] = [functionsOf(source("")), functionsOf(source(" + 1"))];
        // inner and outer; the class's fields, the arrows and other() are what they were.
        expect(after.filter(line => !before.includes(line)).length).toBe(2);
        expect(before.filter(line => !after.includes(line)).length).toBe(2);
      });

      test("where JavaScriptCore says a function starts", () => {
        // kind 0: a function, at its parameters; 1: the inner function of a generator's body, or of an async body that
        // awaits; 2: the function that initializes a class's fields, at the first of them; 3: the constructor of a class
        // that does not write one, at the class.
        const starts = (text: string, kind: "module" | "script" | "builtin" = "module") =>
          namesOf(text, kind)
            .filter(line => !line.startsWith("M "))
            .map(line => line.split(" ").slice(0, 2).join(":"));
        expect(starts("function f(a){}var g=function(a){},h=(a)=>a,i=a=>a;")).toEqual(["10:0", "29:0", "37:0", "46:0"]);
        expect(starts("var f=async(a)=>a,g=async(a)=>await a,h=async a=>{await a};")).toEqual([
          "11:0",
          "25:0",
          "30:1",
          "46:0",
          "49:1",
        ]);
        expect(starts("async function f(){}async function g(){await 1}function*h(){}")).toEqual([
          "16:0",
          "36:0",
          "38:1",
          "57:0",
          "59:1",
        ]);
        expect(starts("class A{a=1;static b=2;static{A.c=3}#d;['e']=5;static [(1,'f')]=6;m(){}}")).toEqual([
          "0:3",
          "8:2",
          "12:2",
          "29:0",
          "67:0",
        ]);
        expect(starts("async function f(){class A{[await 1]=1}}")).toEqual(["16:0", "18:1", "19:3", "27:2"]);
        // A class element whose name starts with an async arrow: two things start where the `async` is.
        expect(starts("class A{[async()=>1]=2;static[(async x=>x)()]=3}")).toEqual([
          "0:3",
          "8:2",
          "14:0",
          "23:2",
          "37:0",
        ]);
        // A hashbang, and text outside ASCII: JavaScriptCore counts in UTF-16 code units.
        expect(starts("#!/usr/bin/env bun\n/* é中\u{1f600} */function f(){}")).toEqual(["39:0"]);
        // A CommonJS chunk is a script, and may say what a module may not.
        expect(
          starts("(function(exports, require, module, __filename, __dirname) {with(module){var a=010}})", "script"),
        ).toEqual(["9:0"]);
        // An internal module is in JavaScriptCore's builtin syntax.
        expect(starts("(function (){return @isCallable(this.@state)?@undefined:1})", "builtin")).toEqual(["10:0"]);
      });

      // A chunk's name is a hash of its contents, and it is what other chunks import it by.
      test("the chunks a chunk imports are not part of its name", () => {
        const chunk = (path: string, chunks: string[]) =>
          namesOf(
            `import{a as b}from"${path}";import{c}from"node:fs";export function f(){return import("${path}").then(()=>b+c)}export{f as d};`,
            "module",
            chunks,
          ).map(line => line.split(" ").at(-1));
        for (const paths of ["/$bunfs/root/", "B:/~BUN/root/", "https://example.com//$bunfs/root/"]) {
          const [one, other] = [`${paths}chunk-0a1b2c3d.js`, `${paths}sub/chunk-4e5f6g7h.js`];
          expect(chunk(one, [other, one])).toEqual(chunk(other, [other, one]));
          // What is not one of the build's chunks is imported by its name, wherever it is.
          expect(chunk(one, [other])).not.toEqual(chunk(other, [other]));
        }
        expect(namesOf(`import{c}from"node:fs";`, "module")).not.toEqual(namesOf(`import{c}from"node:os";`, "module"));
      });

      // A minifier renames bindings and leaves properties: what tells one getter of \`__export(ns, { a: () => a, b: () => b })\`
      // from the next is the property it is the value of.
      test("a function that is the value of a property is named with the property", () => {
        // In the order they are written.
        const names = (text: string) =>
          namesOf(text)
            .filter(line => !line.startsWith("M "))
            .map(line => line.split(" ").at(-1));
        const getters = names(
          `var a = 1, b = 2; export const ns = { a: () => a, b: () => b, ["c"]: () => a, ["d"]: () => b };`,
        );
        expect(getters[0]).not.toBe(getters[1]);
        // A computed name says nothing here.
        expect(getters[2]).toBe(getters[3]);
        expect(names(`var x = 1, y = 2; export const ns = { a: () => x, b: () => y };`).slice(0, 2)).toEqual(
          getters.slice(0, 2),
        );
        const methods = names(
          `export class C { one() { return 1; } static one() { return 1; } get one() { return 1; } two() { return 1; } }`,
        );
        expect(new Set(methods).size).toBe(methods.length);
        // A field's arrow is the value of the field.
        const fields = names(`export class C { onOpen = () => this.emit(); onClose = () => this.emit(); }`);
        expect(new Set(fields).size).toBe(fields.length);
        // The function that initializes fields is named with the functions in them, and not by what is written before
        // the class.
        const initializer = (text: string) =>
          namesOf(text)
            .filter(line => line.split(" ")[1] === "2")
            .map(line => line.split(" ").at(-1));
        expect(initializer(`export class S { static { one(); } }`)).not.toEqual(
          initializer(`export class S { static { two(); } }`),
        );
        expect(initializer(`export class S { h = () => 1; }`)).not.toEqual(
          initializer(`export class S { h = () => 2; }`),
        );
        expect(initializer(`export class S { h = () => 1; static { one(); } }`)).toEqual(
          initializer(`function before() {} export class S { h = () => 1; static { one(); } }`),
        );
        // A class expression in a field that mentions itself.
        const inField = (name: string) =>
          names(`export class R { static Entry = class ${name} { clone() { return new ${name}(this); } }; }`);
        expect(inField("Entry")).toEqual(inField("q"));
        // The constructor a class does not write is named by what the class's members are called.
        const constructorOf = (text: string) =>
          namesOf(text)
            .filter(line => line.split(" ")[1] === "3")
            .map(line => line.split(" ").at(-1));
        expect(constructorOf(`export class A { one() {} }`)).toEqual(
          constructorOf(`export class B { one() { return 1; } }`),
        );
        expect(constructorOf(`export class A { one() {} }`)).not.toEqual(constructorOf(`export class A { two() {} }`));
        expect(constructorOf(`export class A { one() {} }`)).not.toEqual(
          constructorOf(`export class A extends Object { one() {} }`),
        );
      });

      // Generated code has expressions as deep as they are long; what is nested deeper than is walked has no name, and
      // neither has what it is nested in, on whichever thread and however much stack is left.
      test("code that is nested too deeply to walk", () => {
        const long = `export function long(x) { return ${Array(200_000).fill("x").join(" + ")}; }`;
        expect(functionsOf(long).length).toBe(1);
        const chain = `export function chain(x) { return ${Array(2_000).fill("x ? 1").join(" : ")} : 2; }`;
        expect(functionsOf(chain).length).toBe(1);
        // A fluent chain, which is as deep at its start as it is long, is walked like the rest.
        const link = ".object({ a: 1 }).extend(z)";
        const fluent = (last: string) =>
          `export function outer() { return function fluent(z) { return z${Buffer.alloc(1000 * link.length, link).toString()}${last}; }; }`;
        expect(namesOf(fluent(""))).toHaveLength(3);
        expect(functionsOf(fluent(".parse()"))).not.toEqual(functionsOf(fluent("")));
        // How deeply functions are nested in functions is no depth at all: each is walked on its own.
        const arrows = `export const f = ${Buffer.alloc(600 * 7, "() => (").toString()}42${Buffer.alloc(600, ")").toString()};`;
        expect(functionsOf(arrows).length).toBe(600);
        expect(new Set(functionsOf(arrows)).size).toBe(600);
        // What is nested deeper than is walked is left out of the name of the function it is in, and nothing else is.
        const nested = (innermost: string) =>
          `export function outer() { return function deep() { return ${Buffer.alloc(600, "[").toString()}${innermost}${Buffer.alloc(600, "]").toString()}; }; }`;
        expect(namesOf(nested("1"))).toEqual(namesOf(nested("2")));
        expect(namesOf(nested("1"))).toHaveLength(3);
        expect(namesOf(nested("1"))).not.toEqual(namesOf(nested("1").replace("return [", "return 0, [")));
      });

      // A name is a wyhash (seed 0) of bytes that say what is written, which for these two can be written down by hand.
      // A change to them changes what every order file recorded so far calls every function: if that is what a change
      // means to do, it changes the order file's version line ("v2") too.
      test("the bytes a name is a hash of", () => {
        const u64 = (value: number) => [...new Uint8Array(new BigUint64Array([BigInt(value)]).buffer)];
        const f64 = (value: number) => [...new Uint8Array(new Float64Array([value]).buffer)];
        const nameOf = (bytes: number[]) => Bun.hash.wyhash(new Uint8Array(bytes), 0n).toString(16).padStart(16, "0");
        const [ARROW, FUNCTION, LOCAL, NUMBER, END, NONE, RETURN, BINDING] = [2, 1, 4, 6, 7, 8, 0x40 | 3, 0xc0];
        // An arrow that is the value of no property and not async, no parameters, its statements: return <the number 1>.
        expect(namesOf("export default () => 1;").filter(line => !line.startsWith("M "))).toEqual([
          `15 0 ${nameOf([ARROW, NONE, 0, ...u64(0), RETURN, NUMBER, ...f64(1), END])}`,
        ]);
        // A function that is neither async nor a generator and has a name; one parameter, a binding that is the first
        // thing this function (0 functions out) declares, without a default; its statements: return <that binding>.
        const a = [LOCAL, ...u64(0), ...u64(0)];
        expect(namesOf("function f(a) { return a; }").filter(line => !line.startsWith("M "))).toEqual([
          `10 0 ${nameOf([FUNCTION, NONE, 0, 1, ...u64(1), BINDING, ...a, NONE, RETURN, ...a, END])}`,
        ]);
      });
    });

    // Programs that are not like the one recorded below.
    describe("in a program", () => {
      const buildIn = async (dir: string, args: string[], outfile: string, env: Record<string, string> = {}) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", "--bytecode", ...args, "--outfile", outfile],
          env: { ...bunEnv, ...env },
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // What is said about names is said when the build succeeds.
        return {
          stderr:
            exitCode === 0
              ? stderr
                  .split("\n")
                  .filter(line => /names|warn|error/i.test(line))
                  .join("\n")
              : stderr,
          exitCode,
        };
      };
      const runIn = async (dir: string, outfile: string, argv: string[], env: Record<string, string> = {}) => {
        await using proc = Bun.spawn({
          cmd: [join(dir, outfile), ...argv],
          env: { ...bunEnv, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const stats = stderr.split("\n").find(line => line.startsWith("stats "));
        return {
          stdout,
          stderr: stderr
            .split("\n")
            .filter(line => !line.startsWith("stats "))
            .join("\n"),
          stats: stats === undefined ? undefined : JSON.parse(stats.slice("stats ".length)),
          exitCode,
        };
      };
      // Builds, records a run, builds again with the recording, and runs that: every function the program runs is one
      // the order file lists and the build places.
      // A BUN_BYTECODE_ORDER_NAMES_OUT file: for the path of each text, what its code is called.
      const namesIn = (dir: string, name: string) => {
        const texts: Record<string, string[]> = {};
        let key = "";
        for (const line of readFileSync(join(dir, name), "utf8").trimEnd().split("\n")) {
          if (line.startsWith("# ")) texts[(key = line.slice(2))] = [];
          else texts[key].push(line);
        }
        return texts;
      };
      // A build without an order file, and app.order from a run of it.
      const record = async (dir: string, args: string[], stdout: string) => {
        expect(await buildIn(dir, args, exe("plain"))).toEqual({ stderr: "", exitCode: 0 });
        expect(await runIn(dir, exe("plain"), [], { BUN_BYTECODE_ORDER_OUT: join(dir, "app.order") })).toEqual({
          stdout,
          stderr: "",
          stats: undefined,
          exitCode: 0,
        });
      };

      // `edit`: changes the sources between the build that records and the build that is laid out, to `unknown`
      // functions the recording cannot know.
      const roundTrip = async (
        dir: string,
        args: string[],
        stdout: string,
        { edit, unknown = 0 }: { edit?: () => Promise<unknown>; unknown?: number } = {},
      ) => {
        await record(dir, args, stdout);
        const order = readFileSync(join(dir, "app.order"), "utf8");
        expect(order).not.toContain("#");
        await edit?.();
        // BUN_BYTECODE_ORDER_NAMES_OUT: what the build calls every function of every text it links, and what the run
        // that records calls every function of every text its executable has.
        const namesOut = (name: string) => ({ BUN_BYTECODE_ORDER_NAMES_OUT: join(dir, name) });
        expect(
          await buildIn(dir, [...args, "--bytecode-order=app.order"], exe("ordered"), namesOut("build.names")),
        ).toEqual({ stderr: "", exitCode: 0 });
        const ran = await runIn(dir, exe("ordered"), ["stats"]);
        expect({ ...ran, stats: undefined }).toEqual({ stdout, stderr: "", stats: undefined, exitCode: 0 });
        const again = join(dir, "again.order");
        expect(
          await runIn(dir, exe("ordered"), [], { BUN_BYTECODE_ORDER_OUT: again, ...namesOut("run.names") }),
        ).toEqual({ stdout, stderr: "", stats: undefined, exitCode: 0 });
        // Nothing but the text is what a name is made of, and the two have the same text: the same names, for every
        // chunk and internal module, at the same places.
        const byTheBuild = namesIn(dir, "build.names");
        expect(Object.values(byTheBuild).flat().length).toBeGreaterThan(Object.keys(byTheBuild).length);
        expect(namesIn(dir, "run.names")).toEqual(byTheBuild);
        // The names the build gave are the names the run that recorded gave: of what ran, and of what did not.
        expect({ cold: ran.stats.cold, unknownRegion: ran.stats.regions.unknown > 0 }).toEqual({
          cold: 0,
          unknownRegion: unknown > 0,
        });
        expect(ran.stats.unknown).toBeLessThanOrEqual(unknown);
        if (edit) {
          // What the edited program's run calls its functions: all that the edit renamed is what it changed.
          const after = new Set(readFileSync(again, "utf8").split("\n"));
          const renamed = (kind: string) =>
            order.split("\n").filter(line => line.startsWith(kind) && !after.has(line)).length;
          // (A module that imports the edited one by its path, which changed, is not renamed.)
          expect({ functions: renamed("F "), modules: renamed("M ") }).toEqual({ functions: unknown, modules: 1 });
        }
        return { order, stats: ran.stats };
      };

      // The fixture runs every kind of function JavaScriptCore compiles; it starts with a hashbang, and the banner
      // puts text outside ASCII (U+FFFD too, which is text like any other) before every function.
      test("every function JavaScriptCore runs has a name", async () => {
        using dir = tempDir("build-compile-bytecode-order-every", {
          "app.js": await Bun.file(join(import.meta.dir, "fixtures", "bytecode-order-names.js")).text(),
          "data.json": `{ "answer": 42 }`,
        });
        const { order, stats } = await roundTrip(
          String(dir),
          ["--format=esm", "--splitting", "--banner=/* \u00e9\u4e2d\u{1f600}\ufffd */", "app.js"],
          "37\n",
        );
        const functions = order.split("\n").filter(line => line.startsWith("F "));
        expect(functions.length).toBeGreaterThan(40);
        expect(stats.hot).toBeGreaterThanOrEqual(functions.length);
      }, 60_000);

      // A CommonJS chunk is a script to JavaScriptCore, and may say what a module may not.
      test("the functions of a CommonJS chunk that is not strict code have names", async () => {
        using dir = tempDir("build-compile-bytecode-order-sloppy", {
          "app.cjs": `
            const { bytecodeOrderStats } = require("bun:jsc");
            function lookup(scope) { with (scope) { return [value, 010].map(item => item + 1); } }
            console.log(lookup({ value: 1 }).join(","));
            if (process.argv.includes("stats")) console.error("stats " + JSON.stringify(bytecodeOrderStats()));
          `,
        });
        const { stats } = await roundTrip(
          String(dir),
          ["--format=cjs", "--minify", "--banner=/* \u00e9\u4e2d\u{1f600} */", "app.cjs"],
          "2,9\n",
        );
        // The wrapper, lookup and its arrow.
        expect(stats.hot).toBeGreaterThanOrEqual(3);
      }, 60_000);

      // A module a Bun.ModuleGraph loads is private to the graph: JavaScriptCore decodes its code apart from the code
      // cache, once for each graph.
      test("the modules of a Bun.ModuleGraph are recorded, once", async () => {
        using dir = tempDir("build-compile-bytecode-order-graph", {
          "app.js": `
            import { bytecodeOrderStats } from "bun:jsc";
            import { twice } from "./lazy.js";
            const inGraph = name => new Bun.ModuleGraph({ globals: { tenant: name } }).import(new URL("./tenants/tenant.js", import.meta.url).href);
            const [one, two] = await Promise.all([inGraph("one"), inGraph("two")]);
            console.log(one.hotInGraph(2), two.hotInGraph(3), twice(1));
            if (process.argv.includes("stats")) console.error("stats " + JSON.stringify(bytecodeOrderStats()));
          `,
          // An entry point in a directory of its own. Both import the chunk lazy.js is in, by a path that has a hash
          // of what lazy.js says.
          "tenants/tenant.js": `
            import { twice } from "../lazy.js";
            export function hotInGraph(n) { return [n].map(item => twice(item) + tenant.length)[0]; }
            export function neverInGraph(n) { return n - 1; }
          `,
          "lazy.js": `export const twice = n => n * 2;`,
        });
        const { order, stats } = await roundTrip(
          String(dir),
          ["--format=esm", "--splitting", "app.js", "tenants/tenant.js"],
          "7 9 2\n",
          // The chunk of lazy.js gets another path, which is not part of what the code that imports it is called:
          // all that the recording does not know is the function that changed.
          { edit: () => Bun.write(join(String(dir), "lazy.js"), "export const twice = n => n + n;"), unknown: 1 },
        );
        const lines = order.split("\n");
        // app.js, tenant.js and lazy.js were evaluated, no module was not; hotInGraph and its arrow are listed once.
        expect(lines.filter(line => line.startsWith("M ")).length).toBe(3);
        expect(lines.filter(line => line.startsWith("N "))).toEqual([]);
        expect(new Set(lines).size).toBe(lines.length);
        // So the next build has tenant.js among the modules the run evaluated, and hotInGraph with the code it ran.
        expect(stats.regions.lateModuleHeads).toBe(0);
        expect(stats.regions.hot).toBeGreaterThan(0);
      }, 60_000);

      const twoEntryPoints = {
        "app.js": `
          import { twice } from "./lazy.js";
          import { existsSync } from "node:fs";
          import { bytecodeOrderStats } from "bun:jsc";
          function callsTwice(n) { return twice(n) + Number(existsSync(".")); }
          console.log(callsTwice(2));
          if (process.argv.includes("stats")) console.error("stats " + JSON.stringify(bytecodeOrderStats()));
        `,
        "sub/other.js": `
          import { twice } from "../lazy.js";
          export function other(n) { return twice(n); }
          console.log(other(3));
        `,
        "lazy.js": `export const twice = n => n * 2;`,
      };
      const twoEntryPointArgs = ["--format=esm", "--splitting", "app.js", "sub/other.js"];

      // An executable for Windows has its chunks at B:/~BUN/root/. This bun stands in for the Windows one (its builtins
      // section is what the internal modules are named from), so the program cannot be put in it: the build fails
      // there, after the link wrote what it calls the code. (On Windows that build is the round trips above.)
      test.skipIf(isWindows)(
        "a build for Windows calls the code what a build for this platform calls it",
        async () => {
          using dir = tempDir("build-compile-bytecode-order-windows", twoEntryPoints);
          await record(String(dir), twoEntryPointArgs, "5\n");
          const namesOfBuild = async (target: string[], outfile: string, root: string) => {
            const build = await buildIn(
              String(dir),
              [...twoEntryPointArgs, ...target, "--bytecode-order=app.order"],
              outfile,
              {
                BUN_BYTECODE_ORDER_NAMES_OUT: join(String(dir), outfile + ".names"),
              },
            );
            // Without where the chunks are, the executable's name, and the hash of a chunk's contents (the paths it
            // imports chunks by are part of those).
            const names = Object.entries(namesIn(String(dir), outfile + ".names"))
              .map(([path, names]) => [
                path
                  .replace(root, "")
                  .replace(outfile, "<entry>")
                  .replace(/-[a-z0-9]{8}\.js$/, ".js"),
                names,
              ])
              .sort();
            expect(new Set(names.map(([path]) => path)).size).toBe(names.length);
            return { build, names };
          };
          const here = await namesOfBuild([], "thisplatform", "/$bunfs/root/");
          expect(here.build).toEqual({ stderr: "", exitCode: 0 });
          const windows = await namesOfBuild(
            ["--target=bun-windows-x64", `--compile-executable-path=${bunExe()}`],
            "windows.exe",
            "B:/~BUN/root/",
          );
          expect(windows.build.stderr).toContain("failed to write compiled executable");
          expect(windows.build.stderr).not.toContain("names");
          // The three chunks, and node:fs with the internal modules it needs.
          expect(here.names.length).toBeGreaterThan(3);
          expect(windows.names).toEqual(here.names);
        },
        60_000,
      );

      // The runtime runs a module from its source when the bytecode it has is not for that source. Such a run did not
      // see what the module's code does: the recording says nothing about it, not that it did not run.
      // (Linux: elsewhere the edit breaks the signature.)
      test.skipIf(!isLinux)(
        "a module whose bytecode the run did not use is not listed as not run",
        async () => {
          using dir = tempDir("build-compile-bytecode-order-rejected", {
            "app.js": `const { twice } = await import("./lazy.js"); console.log(twice(2));`,
            "lazy.js": `export const twice = n => [n].map(markerOfLazy => markerOfLazy * 2)[0];`,
          });
          const args = ["--format=esm", "--splitting", "app.js"];
          expect(await buildIn(String(dir), args, exe("plain"))).toEqual({ stderr: "", exitCode: 0 });
          const record = async (name: string) => {
            const out = join(String(dir), name);
            expect(await runIn(String(dir), exe("plain"), [], { BUN_BYTECODE_ORDER_OUT: out })).toEqual({
              stdout: "4\n",
              stderr: "",
              stats: undefined,
              exitCode: 0,
            });
            const lines = readFileSync(out, "utf8").split("\n");
            return Object.fromEntries(["F", "K", "M", "N"].map(kind => [kind, lines.filter(line => line[0] === kind)]));
          };
          const used = await record("used.order");
          expect({ M: used.M.length, N: used.N.length }).toEqual({ M: 2, N: 0 });

          // The first bytes of lazy.js's bytecode say which version of the cache wrote it.
          const outfile = join(String(dir), exe("plain"));
          const file = readFileSync(outfile);
          const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined, "latin1");
          const offsets = trailer - 32;
          const base = offsets - Number(file.readBigUInt64LE(offsets));
          const modules = { offset: file.readUInt32LE(offsets + 8), length: file.readUInt32LE(offsets + 12) };
          let edited = 0;
          for (let at = base + modules.offset; at < base + modules.offset + modules.length; at += 52) {
            const contents = { offset: file.readUInt32LE(at + 8), length: file.readUInt32LE(at + 12) };
            const source = file.toString("latin1", base + contents.offset, base + contents.offset + contents.length);
            if (!source.includes("markerOfLazy")) continue;
            file.fill(0xff, base + file.readUInt32LE(at + 24), base + file.readUInt32LE(at + 24) + 8);
            edited++;
          }
          expect(edited).toBe(1);
          writeFileSync(outfile, file);

          const unused = await record("unused.order");
          // app.js ran from its bytecode; lazy.js is neither evaluated nor not, and none of its functions is listed.
          expect({ M: unused.M, N: unused.N }).toEqual({ M: used.M.filter(line => unused.M.includes(line)), N: [] });
          expect(unused.M.length).toBe(1);
          const ofLazy = used.F.concat(used.K)
            .filter(line => !unused.F.includes(line))
            .map(line => line.slice(2));
          expect(ofLazy.length).toBeGreaterThanOrEqual(2);
          expect(unused.K.map(line => line.slice(2)).filter(name => ofLazy.includes(name))).toEqual([]);
        },
        60_000,
      );
    });

    describe("with a recorded run", () => {
      // What every test starts from, made once, in a hook so that no test's clock includes it: the plain build, two
      // recordings of it (the second is another way of starting the program) and the build ordered by the first. One build
      // at a time: each links an executable the size of bun, and CI has few cores. For the same reason the tests that
      // build are not concurrent; the ones that only run what is already built are.
      let shared: { order: string; plain: Awaited<ReturnType<typeof run>>; orderedStderr: string };
      beforeAll(async () => {
        dir = tempDir("build-compile-bytecode-order", files);
        expect((await compile(exe("plain"), [])).exitCode).toBe(0);
        const plain = await run(exe("plain"), recordedArgv, { BUN_BYTECODE_ORDER_OUT: join(cwd(), "plain.order") });
        const other = await run(exe("plain"), ["f", "rev"], { BUN_BYTECODE_ORDER_OUT: join(cwd(), "other.order") });
        const ordered = await compile(exe("ordered"), ["--bytecode-order=plain.order"]);
        expect({ ordered: ordered.exitCode, other: other.exitCode }).toEqual({ ordered: 0, other: 0 });
        shared = { order: await Bun.file(join(cwd(), "plain.order")).text(), plain, orderedStderr: ordered.stderr };
      }, 300_000);

      test.concurrent(
        "a run of the ordered build reads the same things and decodes to the same code",
        async () => {
          const { order, plain } = shared;
          // Nothing but the five kinds of lines: a recording says so, in a line of another kind, when something the run
          // decoded could not be named.
          expect(order.split("\n").filter(line => !/^(v2|[FSMNK] [0-9a-f]{16}|)$/.test(line))).toEqual([]);
          expect(plain).toEqual({
            stdout: "APPAPP 2a4a6 AA/a+/3-a 2b4b6 BB/b+/3-b 2c4c6 CC/c+/3-c\n",
            cacheHits: expect.any(Number),
            exitCode: 0,
          });
          // The entry point's chunk, the shared one, and a, b, c.
          expect(plain.cacheHits).toBe(5);
          expect(order).toStartWith("v2\n");
          for (const kind of ["F", "S", "M", "N", "K"])
            expect(order).toMatch(new RegExp(`^${kind} [0-9a-f]{16}$`, "m"));
          expect(hasLinkedPayload(exe("plain"))).toBe(false);
          expect(hasLinkedPayload(exe("ordered"))).toBe(true);

          // What the recorded run read comes first: the heads of the modules it evaluated, then the bodies it decoded. The
          // modules it never loaded have their heads after that, and everything else follows.
          const { payloadLength, regionEnds, entry } = linkedLayout(exe("ordered"));
          const [evaluatedHeadsEnd, hotBodiesEnd, , otherHeadsEnd, coldBodiesEnd, expressionInfoEnd] = regionEnds;
          expect(evaluatedHeadsEnd).toBeGreaterThan(0);
          expect(hotBodiesEnd).toBeGreaterThan(evaluatedHeadsEnd);
          expect(otherHeadsEnd).toBeGreaterThan(hotBodiesEnd);
          expect(coldBodiesEnd).toBeGreaterThan(otherHeadsEnd);
          expect(expressionInfoEnd).toBe(payloadLength);
          expect(Object.keys(entry).sort()).toEqual(["a", "app", "b", "c", "d", "e", "f"]);
          for (const name of ["app", "a", "b", "c"]) expect(entry[name], name).toBeLessThan(evaluatedHeadsEnd);
          for (const name of ["d", "e", "f"]) {
            expect(entry[name], name).toBeGreaterThanOrEqual(hotBodiesEnd);
            expect(entry[name], name).toBeLessThan(otherHeadsEnd);
          }
          const again = await run(exe("ordered"), recordedArgv, {
            BUN_BYTECODE_ORDER_OUT: join(cwd(), "ordered.order"),
          });
          expect(again).toEqual(plain);
          expect(await Bun.file(join(cwd(), "ordered.order")).text()).toBe(order);
          expect(await digests(exe("ordered"))).toBe(await digests(exe("plain")));
        },
        60_000,
      );

      // Nothing in the layout depends on the order modules load in or functions are first called in: a module finds its
      // code through its own entry, wherever the recorded run's order put it.
      test.concurrent.each([
        ["the recorded modules in reverse, functions in the other order", ["c", "b", "a", "rev"]],
        ["modules the recorded run never loaded, before any it did", ["f", "d", "a", "e", "c", "b"]],
        ["only modules the recorded run never loaded", ["e", "rev", "d", "f"]],
      ])(
        "load order: %s",
        async (_label, argv) => {
          const expected = await run(exe("plain"), argv);
          expect(expected.exitCode).toBe(0);
          expect(await run(exe("ordered"), argv)).toEqual(expected);
        },
        60_000,
      );

      test("compile.bytecodeOrder", async () => {
        const { plain } = shared;
        const viaApi = await Bun.build({
          entrypoints: [join(cwd(), "app.js")],
          bytecode: true,
          splitting: true,
          format: "esm",
          minify: true,
          compile: {
            outfile: join(cwd(), exe("api")),
            bytecodeOrder: [join(cwd(), "plain.order"), join(cwd(), "other.order")],
          },
        });
        expect(viaApi.success).toBe(true);
        expect(hasLinkedPayload(exe("api"))).toBe(true);
        expect(await run(exe("api"), recordedArgv)).toEqual(plain);
      }, 60_000);

      test("several files on the command line", async () => {
        const { plain } = shared;
        const build = await compile(exe("merged"), ["--bytecode-order=plain.order,other.order"]);
        expect({ stderr: build.stderr.includes("error"), exitCode: build.exitCode }).toEqual({
          stderr: false,
          exitCode: 0,
        });
        expect(hasLinkedPayload(exe("merged"))).toBe(true);
        expect(await run(exe("merged"), recordedArgv)).toEqual(plain);
      }, 60_000);

      test("the same order file gives the same executable", async () => {
        // Into a directory of its own, so that the executable has the name of the one the hook built.
        const again = join("again", exe("ordered"));
        // As an editor may save it: a byte order mark, and lines before the version line that say nothing.
        await Bun.write(join(cwd(), "saved.order"), "\ufeff\r\n# recorded on a Tuesday\r\n" + shared.order);
        // (Given twice, as two flags: what the second adds to the first is nothing.)
        const build = await compile(again, ["--bytecode-order=plain.order", "--bytecode-order=saved.order"]);
        expect({ stderr: build.stderr.includes("error"), exitCode: build.exitCode }).toEqual({
          stderr: false,
          exitCode: 0,
        });
        expect(readFileSync(join(cwd(), again)).equals(readFileSync(join(cwd(), exe("ordered"))))).toBe(true);
      }, 60_000);

      // The order file also lists the functions its build had and its run did not decode. A function in neither list is
      // new or changed since the recording; those get a region of their own next to the hot one instead of being cold.
      test("functions the recorded build did not have", async () => {
        const [, hotBodiesEnd, unknownBodiesEnd] = linkedLayout(exe("ordered")).regionEnds;
        expect(unknownBodiesEnd).toBe(hotBodiesEnd);

        using editedDir = tempDir("build-compile-bytecode-order-edited", {
          ...files,
          "a.js":
            files["a.js"].replace("x * n", "(x + 1) * n - n") +
            `\nexport function added(list) { return list.filter(Boolean).length; }`,
          // Only first() itself: the two arrows in it are the recorded code.
          "b.js": files["b.js"].replace("return pick([1, 2, 3]);", "return pick([1, 2, 3].slice());"),
        });
        const build = async (args: string[], outfile: string) => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "build", ...buildArgs, ...args, "--outfile", outfile],
            env: bunEnv,
            cwd: editedDir + "",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stderr: exitCode === 0 ? "" : stderr, exitCode };
        };
        // Independent of each other: at the same time.
        const [plainBuild, orderedBuild] = await Promise.all([
          build([], exe("plain")),
          build([`--bytecode-order=${join(cwd(), "plain.order")}`], exe("ordered")),
        ]);
        expect(plainBuild).toEqual({ stderr: "", exitCode: 0 });
        expect(orderedBuild).toEqual({ stderr: "", exitCode: 0 });
        const file = (name: string) => join("..", editedDir.toString().split(/[\\/]/).pop()!, name);
        const edited = linkedLayout(file(exe("ordered")));
        expect(edited.regionEnds[2]).toBeGreaterThan(edited.regionEnds[1]);
        const expected = await run(file(exe("plain")), recordedArgv);
        expect(expected).toEqual({
          stdout: "APPAPP 2a4a6 AA/a+/3-a 2b4b6 BB/b+/3-b 2c4c6 CC/c+/3-c\n",
          cacheHits: 5,
          exitCode: 0,
        });
        expect(await run(file(exe("ordered")), recordedArgv)).toEqual(expected);
        // A function is named by its code and, through their names, the code of everything written in it: in a, the
        // edited arrow, the arrow around it and first() are new; in b, first() is. Everything else the run decodes is
        // still the recorded code (shared, second, the other modules' functions, and the arrows in b's first(), which are
        // in the hot region although the function they are written in is not), and what is new sits next to it, not in
        // the cold region.
        expect(await stats(file(exe("ordered")), recordedArgv)).toMatchObject({
          hot: expect.any(Number),
          unknown: 4,
          cold: 0,
        });
        // Code that was written before the function around it decodes like any other.
        const digestsOf = async (outfile: string) => {
          const out = join(String(editedDir), outfile + ".digest");
          expect((await run(file(outfile), [], { BUN_BYTECODE_DIGEST_OUT: out })).exitCode).toBe(0);
          return readFileSync(out, "utf8").replaceAll(outfile, "<entry>");
        };
        expect(await digestsOf(exe("ordered"))).toBe(await digestsOf(exe("plain")));
      }, 60_000);

      // bun:jsc's bytecodeOrderStats(): the function bodies a run decoded, by the region of the payload they are in.
      test("bytecodeOrderStats counts what a run decodes by region", async () => {
        expect(
          await stats(exe("plain"), recordedArgv, { BUN_BYTECODE_ORDER_OUT: join(cwd(), "stats.order") }),
        ).toBeNull();
        expect((await compile(exe("counted"), ["--bytecode-order=stats.order"])).exitCode).toBe(0);
        const { payloadLength, regionEnds } = linkedLayout(exe("counted"));

        // The recorded path again: everything it decodes is where the order file put it.
        const same = await stats(exe("counted"), recordedArgv);
        expect(same).toEqual({
          hot: expect.any(Number),
          unknown: 0,
          cold: 0,
          hotBytes: expect.any(Number),
          unknownBytes: 0,
          coldBytes: 0,
          regions: {
            moduleHeads: regionEnds[0],
            hot: regionEnds[1] - regionEnds[0],
            unknown: regionEnds[2] - regionEnds[1],
            lateModuleHeads: regionEnds[3] - regionEnds[2],
            cold: regionEnds[4] - regionEnds[3],
            expressionInfo: payloadLength - regionEnds[4],
          },
        });
        // shared and its arrow, and first, its arrow and second of a, b and c.
        expect(same.hot).toBeGreaterThanOrEqual(11);
        expect(same.hotBytes).toBeGreaterThan(0);
        expect(same.hotBytes).toBeLessThanOrEqual(same.regions.hot);

        // A path the recorded run never took: d's functions are with everything else.
        const other = await stats(exe("counted"), ["d"]);
        expect(other.hot).toBeGreaterThan(0);
        expect(other.cold).toBeGreaterThanOrEqual(3);
        expect(other.coldBytes).toBeGreaterThan(0);
        expect(other.unknown).toBe(0);
      }, 60_000);

      // Every VM of the process records: what only a Worker evaluated or called is in the order file too.
      test("a Worker's modules and functions are recorded", async () => {
        using workerDir = tempDir("build-compile-bytecode-order-worker", {
          "main.js": `
          import { shared } from "./shared.js";
          import { bytecodeOrderStats } from "bun:jsc";
          let fromWorker = { text: "no worker" };
          if (process.argv.includes("worker")) {
            const worker = new Worker("./worker.js");
            fromWorker = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
            await worker.terminate();
          }
          console.log(shared("main"), fromWorker.text);
          if (process.argv.includes("stats"))
            console.error("stats " + JSON.stringify({ main: bytecodeOrderStats(), worker: fromWorker.stats }));
        `,
          "worker.js": `
          import { shared } from "./shared.js";
          import { bytecodeOrderStats } from "bun:jsc";
          function onlyTheWorkerCallsThis(list) { return list.map(item => shared(item)).reverse().join("+"); }
          postMessage({ text: onlyTheWorkerCallsThis(["w", "k"]), stats: bytecodeOrderStats() });
        `,
          "shared.js": `export function shared(tag) { const twice = text => text + text; return twice(tag).toUpperCase(); }`,
        });
        const workerCwd = workerDir + "";
        const workerBuildArgs = [
          "--compile",
          "--bytecode",
          "--splitting",
          "--format=esm",
          "--minify",
          "main.js",
          "worker.js",
        ];
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", ...workerBuildArgs, "--outfile", exe("app")],
          env: bunEnv,
          cwd: workerCwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, , buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        expect(buildExit).toBe(0);
        const record = async (argv: string[], out: string) => {
          await using proc = Bun.spawn({
            cmd: [join(workerCwd, exe("app")), ...argv],
            env: { ...bunEnv, BUN_BYTECODE_ORDER_OUT: join(workerCwd, out) },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          const lines = (await Bun.file(join(workerCwd, out)).text()).split("\n");
          const of = (kind: string) =>
            new Set(lines.filter(line => line.startsWith(kind + " ")).map(line => line.slice(2)));
          const other = lines.filter(line => !/^(v2|[FSMNK] [0-9a-f]{16}|)$/.test(line));
          return {
            stdout,
            exitCode,
            other,
            evaluated: of("M"),
            notEvaluated: of("N"),
            decoded: of("F"),
            notDecoded: of("K"),
          };
        };
        const [alone, withWorker] = await Promise.all([record([], "alone.order"), record(["worker"], "worker.order")]);
        expect({ stdout: alone.stdout, exitCode: alone.exitCode, other: alone.other }).toEqual({
          stdout: "MAINMAIN no worker\n",
          exitCode: 0,
          other: [],
        });
        expect({ stdout: withWorker.stdout, exitCode: withWorker.exitCode, other: withWorker.other }).toEqual({
          stdout: "MAINMAIN KK+WW\n",
          exitCode: 0,
          other: [],
        });
        // The worker's chunk: evaluated only when the Worker ran, and known not to have been otherwise.
        const onlyWithWorker = [...withWorker.evaluated].filter(hash => !alone.evaluated.has(hash));
        expect(onlyWithWorker.length).toBeGreaterThanOrEqual(1);
        for (const hash of onlyWithWorker) expect(alone.notEvaluated.has(hash)).toBe(true);
        // Likewise the function only the Worker calls.
        const decodedOnlyWithWorker = [...withWorker.decoded].filter(hash => !alone.decoded.has(hash));
        expect(decodedOnlyWithWorker.length).toBeGreaterThanOrEqual(1);
        for (const hash of decodedOnlyWithWorker) expect(alone.notDecoded.has(hash)).toBe(true);

        // bytecodeOrderStats() counts per thread, in a Worker too.
        await using ordered = Bun.spawn({
          cmd: [bunExe(), "build", ...workerBuildArgs, "--bytecode-order=worker.order", "--outfile", exe("ordered")],
          env: bunEnv,
          cwd: workerCwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, orderedStderr, orderedExit] = await Promise.all([
          ordered.stdout.text(),
          ordered.stderr.text(),
          ordered.exited,
        ]);
        expect({ stderr: orderedExit === 0 ? "" : orderedStderr, exitCode: orderedExit }).toEqual({
          stderr: "",
          exitCode: 0,
        });
        await using counted = Bun.spawn({
          cmd: [join(workerCwd, exe("ordered")), "worker", "stats"],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [countedStdout, countedStderr, countedExit] = await Promise.all([
          counted.stdout.text(),
          counted.stderr.text(),
          counted.exited,
        ]);
        expect(countedStdout).toBe("MAINMAIN KK+WW\n");
        const line = countedStderr.split("\n").find(line => line.startsWith("stats "));
        expect(line).toBeDefined();
        const { main, worker } = JSON.parse(line!.slice("stats ".length));
        // The Worker: onlyTheWorkerCallsThis and its arrow, shared and its arrow. The main thread: shared and its arrow.
        expect(worker.hot).toBeGreaterThanOrEqual(4);
        expect(main.hot).toBeGreaterThanOrEqual(2);
        expect(worker.regions).toEqual(main.regions);
        expect(countedExit).toBe(0);
      }, 60_000);

      // Digesting decodes all the code there is and reads every string: it comes after the recording is taken.
      test.concurrent("digests written by a recording run do not change its order file", async () => {
        const out = join(cwd(), "with-digests.order");
        const ran = await run(exe("plain"), recordedArgv, {
          BUN_BYTECODE_ORDER_OUT: out,
          BUN_BYTECODE_DIGEST_OUT: join(cwd(), "with-digests.digest"),
        });
        expect(ran).toEqual(shared.plain);
        expect(readFileSync(join(cwd(), "with-digests.digest"), "utf8")).not.toContain(" - -");
        const lines = (text: string) => new Set(text.split("\n"));
        expect(lines(readFileSync(out, "utf8"))).toEqual(lines(shared.order));
      });

      test("an order file that cannot be read or used", async () => {
        const { plain } = shared;
        const missing = await compile(exe("missing"), ["--bytecode-order=does-not-exist.order"]);
        expect(missing.stderr).toContain("cannot read the bytecode order file does-not-exist.order");
        expect(missing.exitCode).not.toBe(0);
        // Said before anything is parsed, not after the link: the entry point's own error is never reached.
        await Bun.write(join(cwd(), "syntax-error.js"), "let let = 1;");
        await using early = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--bytecode",
            "--format=esm",
            "--bytecode-order=does-not-exist.order",
            "syntax-error.js",
            "--outfile",
            exe("missing"),
          ],
          env: bunEnv,
          cwd: cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, earlyStderr, earlyExitCode] = await Promise.all([
          early.stdout.text(),
          early.stderr.text(),
          early.exited,
        ]);
        expect(earlyStderr).toContain("cannot read the bytecode order file does-not-exist.order");
        expect(earlyStderr).not.toContain("syntax-error.js");
        expect(earlyExitCode).not.toBe(0);

        await using withoutBytecode = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--format=esm",
            "--bytecode-order=plain.order",
            "app.js",
            "--outfile",
            exe("rejected"),
          ],
          env: bunEnv,
          cwd: cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([
          withoutBytecode.stdout.text(),
          withoutBytecode.stderr.text(),
          withoutBytecode.exited,
        ]);
        expect(stderr).toContain("--bytecode-order requires --compile --bytecode");
        expect(exitCode).not.toBe(0);
        expect(() =>
          Bun.build({
            entrypoints: [join(cwd(), "app.js")],
            compile: { outfile: join(cwd(), exe("rejected")), bytecodeOrder: "plain.order" },
          }),
        ).toThrow("compile.bytecodeOrder requires bytecode: true");
        // An empty path names no file: the API says so, the command line's list just has nothing between two commas.
        for (const bytecodeOrder of ["", ["plain.order", ""]]) {
          expect(() =>
            Bun.build({
              entrypoints: [join(cwd(), "app.js")],
              bytecode: true,
              compile: { outfile: join(cwd(), exe("rejected")), bytecodeOrder },
            }),
          ).toThrow("compile.bytecodeOrder must not contain an empty path");
        }
        // The error is about the entry that is not a path, not about the array it is in.
        expect(() =>
          Bun.build({
            entrypoints: [join(cwd(), "app.js")],
            bytecode: true,
            compile: { outfile: join(cwd(), exe("rejected")), bytecodeOrder: ["plain.order", 5 as unknown as string] },
          }),
        ).toThrow('The "compile.bytecodeOrder" property must be of type string or array of strings. Received number');
        // `false`, `null` and `[]` are no order file (`haveProfile && path`): the options after it are looked at.
        for (const bytecodeOrder of [false, null, [] as string[]]) {
          expect(() =>
            Bun.build({
              entrypoints: [join(cwd(), "app.js")],
              bytecode: true,
              compile: {
                outfile: join(cwd(), exe("rejected")),
                bytecodeOrder,
                jitPolicy: "8" as unknown as number,
              },
            }),
          ).toThrow("compile.jitPolicy");
        }
        // Lines that are not hints (unknown kinds, bad or reserved hashes) are skipped: nothing is left, so nothing changes.
        await Bun.write(join(cwd(), "junk.order"), "v2\nX 0123456789abcdef\nF nothex\nF ffffffffffffffff\n\n");
        // Nor is a file of another version, whose names are names of something else, or one that is no order file.
        await Bun.write(join(cwd(), "older.order"), shared.order.replace(/^v2\n/, "v1\n"));
        await Bun.write(join(cwd(), "utf16.order"), Buffer.from("\ufeff" + shared.order, "utf16le"));
        await Bun.write(
          join(cwd(), "not-recorded.order"),
          "v2\n# not recorded: none of the program's code has names\n",
        );
        await Bun.write(join(cwd(), "not-one.order"), "F 0123456789abcdef\n");
        // The two builds that succeed, at the same time.
        const [emptyEntry, junk] = await Promise.all([
          compile(exe("empty-entry"), ["--bytecode-order=,plain.order,,"]),
          compile(exe("junk"), [
            "--bytecode-order=junk.order,older.order,not-one.order,utf16.order,not-recorded.order",
          ]),
        ]);
        expect(emptyEntry.stderr).not.toContain("bytecode order file");
        expect(emptyEntry.exitCode).toBe(0);
        expect(hasLinkedPayload(exe("empty-entry"))).toBe(true);
        expect(junk.stderr).toContain("the bytecode order file junk.order lists nothing");
        expect(junk.stderr).toContain(
          "the bytecode order file older.order was recorded by another version of Bun: record it again",
        );
        expect(junk.stderr).toContain("the bytecode order file not-one.order is not a bytecode order file");
        expect(junk.stderr).toContain("the bytecode order file utf16.order is UTF-16: write it as UTF-8");
        expect(junk.stderr).toContain(
          "the bytecode order file not-recorded.order was written by a run that recorded nothing: see what that run printed",
        );
        expect(junk.exitCode).toBe(0);
        expect(hasLinkedPayload(exe("junk"))).toBe(false);
        expect(await run(exe("junk"), recordedArgv)).toEqual(plain);
      }, 60_000);

      // The run is the program's: what goes wrong with the file is said on stderr and changes nothing else, and nothing
      // that is already at the path is removed, an empty directory included.
      test.concurrent(
        "BUN_BYTECODE_ORDER_OUT that cannot be written",
        async () => {
          const { plain } = shared;
          // Its own directory: the file is written next to where it goes, and other tests record into cwd().
          const parent = join(cwd(), "unwritable");
          mkdirSync(parent, { recursive: true });
          for (const [variable, name] of [
            ["BUN_BYTECODE_ORDER_OUT", "order-out-dir"],
            ["BUN_BYTECODE_DIGEST_OUT", "digest-out-dir"],
          ]) {
            const directory = join(parent, name);
            mkdirSync(directory, { recursive: true });
            // A directory, the name of one that is not there, a file in one that is not there.
            const outs = [directory, join(parent, "no-such-dir") + sep, join(parent, "no-such-dir", "out.order")];
            for (const out of outs) {
              await using proc = Bun.spawn({
                cmd: [join(cwd(), exe("plain")), ...recordedArgv],
                env: { ...bunEnv, [variable]: out },
                stdout: "pipe",
                stderr: "pipe",
              });
              const [stdout, stderr, exitCode] = await Promise.all([
                proc.stdout.text(),
                proc.stderr.text(),
                proc.exited,
              ]);
              expect({ stdout, exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
              expect(stderr).toContain(out);
              expect(stderr).toMatch(out.endsWith("out.order") ? /ENOENT/ : /EISDIR|EEXIST|ENOTEMPTY|EPERM|EACCES/);
            }
            expect(existsSync(directory) && statSync(directory).isDirectory()).toBe(true);
            expect(readdirSync(directory)).toEqual([]);
          }
          expect(readdirSync(parent).sort()).toEqual(["digest-out-dir", "order-out-dir"]);
        },
        60_000,
      );

      // A VM that records keeps the unlinked code it decoded (Bun.shrink() is what an idle VM does to drop it), so that
      // what it records does not depend on when the collector runs; a VM that does not record decodes it again.
      test("a recording run decodes each function once", async () => {
        const { order } = shared;
        using dir = tempDir("build-compile-bytecode-order-keep-code", {
          "app.js": `
            import { bytecodeOrderStats } from "bun:jsc";
            function work(n) {
              const middle = m => {
                const inner = k => k * 3 - k;
                return inner(m) + 1;
              };
              return middle(n) + 1;
            }
            const decoded = () => {
              const stats = bytecodeOrderStats();
              return stats.hot + stats.unknown + stats.cold;
            };
            // Back in the event loop the VM is idle, which is when it shrinks.
            const idle = () => new Promise(resolve => setImmediate(resolve));
            // Once around first, so that the second time decodes nothing for the first time.
            const round = async () => {
              await idle();
              work(1);
              return decoded();
            };
            const before = await round();
            // A shrink that finds a collection under way leaves the code for the next one.
            let after = before;
            for (let attempt = 0; attempt < 10 && after === before; attempt++) {
              Bun.shrink();
              after = await round();
            }
            console.log(after > before ? "decoded again" : "kept");
          `,
          // Another program's, but an order file: bytecodeOrderStats() counts decodes out of a linked payload.
          "app.order": order,
        });
        await using build = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--bytecode",
            "--format=esm",
            "app.js",
            "--bytecode-order=app.order",
            "--outfile",
            exe("app"),
          ],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, buildStderr, buildExitCode] = await Promise.all([
          build.stdout.text(),
          build.stderr.text(),
          build.exited,
        ]);
        expect({ stderr: buildStderr.includes("error"), exitCode: buildExitCode }).toEqual({
          stderr: false,
          exitCode: 0,
        });
        const runWith = async (env: Record<string, string>) => {
          await using proc = Bun.spawn({
            cmd: [join(String(dir), exe("app"))],
            env: { ...bunEnv, ...env },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stdout, stderr, exitCode };
        };
        expect(await runWith({})).toEqual({ stdout: "decoded again\n", stderr: "", exitCode: 0 });
        expect(await runWith({ BUN_BYTECODE_ORDER_OUT: join(String(dir), "out.order") })).toEqual({
          stdout: "kept\n",
          stderr: "",
          exitCode: 0,
        });
        const functions = readFileSync(join(String(dir), "out.order"), "utf8")
          .split("\n")
          .filter(line => line.startsWith("F "));
        expect(functions.length).toBeGreaterThan(3);
        expect(new Set(functions).size).toBe(functions.length);
      }, 60_000);

      // A chunk JSC cannot compile has no bytecode, as without an order file: the build says so and goes on, the other
      // chunks are laid out, and the module runs from its source.
      test("a chunk without bytecode", async () => {
        const { order } = shared;
        using broken = tempDir("build-compile-bytecode-order-broken", {
          "app.js": `
            import { ok } from "./ok.js";
            console.log("main", ok());
            if (process.argv.includes("bad")) {
              try {
                const { bad } = await import("./bad.js");
                console.log(bad("x"));
              } catch (error) {
                console.log(error.name);
              }
            }
          `,
          "ok.js": `export function ok() { return "ok"; }`,
          // The bundler passes a regular expression through; JSC rejects this one when it compiles the chunk.
          "bad.js": String.raw`export function bad(s) { return /\p{NotAProperty}/u.test(s); }`,
          // Another program's, but an order file: the chunks go through the link encoder.
          "app.order": order,
        });
        await using build = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--bytecode",
            "--splitting",
            "--format=esm",
            "app.js",
            "--bytecode-order=app.order",
            "--outfile",
            join(cwd(), exe("broken")),
          ],
          env: bunEnv,
          cwd: String(broken),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        expect(stderr).toMatch(/Failed to generate bytecode for \S*bad/);
        expect(exitCode).toBe(0);
        expect(hasLinkedPayload(exe("broken"))).toBe(true);
        expect(await run(exe("broken"), [])).toMatchObject({ stdout: "main ok\n", exitCode: 0 });
        expect(await run(exe("broken"), ["bad"])).toMatchObject({ stdout: "main ok\nSyntaxError\n", exitCode: 0 });
      }, 60_000);

      // %p in the path is the pid, so that every process of a run that starts several writes a file of its own.
      test.concurrent(
        "%p in BUN_BYTECODE_ORDER_OUT and BUN_BYTECODE_DIGEST_OUT is the pid",
        async () => {
          const { plain } = shared;
          await using proc = Bun.spawn({
            cmd: [join(cwd(), exe("plain")), ...recordedArgv],
            env: {
              ...bunEnv,
              BUN_BYTECODE_ORDER_OUT: join(cwd(), "pid-%p.order"),
              BUN_BYTECODE_DIGEST_OUT: join(cwd(), "pid-%p.digest"),
            },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stdout, stderr, exitCode }).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
          const written = readdirSync(cwd())
            .filter(file => file.startsWith("pid-"))
            .sort();
          expect(written).toEqual([`pid-${proc.pid}.digest`, `pid-${proc.pid}.order`]);
          expect((await Bun.file(join(cwd(), `pid-${proc.pid}.order`)).text()).startsWith("v2\n")).toBe(true);
        },
        60_000,
      );

      // A file that fits next to nothing of the program says so, and changes no behavior.
      test("an order file of another program", async () => {
        const { plain, orderedStderr } = shared;
        const hashes = Array.from({ length: 64 }, (_, i) => `F ${(i + 1).toString(16).padStart(16, "0")}`).join("\n");
        await Bun.write(join(cwd(), "other-program.order"), `v2\n${hashes}\n`);
        const other = await compile(exe("other-program"), ["--bytecode-order=other-program.order"]);
        expect(other.stderr).toContain("none of the 64 functions the bytecode order files list is in this build");
        expect(other.exitCode).toBe(0);
        expect(await run(exe("other-program"), recordedArgv)).toEqual(plain);
        // The program's own file does not.
        expect(orderedStderr).not.toContain("the bytecode order files list");
      }, 60_000);

      // The file is read once, front to back.
      test.skipIf(!isPosix)(
        "an order file that is a pipe",
        async () => {
          const { plain, order } = shared;
          const piped = await compile(exe("piped"), ["--bytecode-order=/dev/stdin"], {}, order);
          expect(piped.stderr).not.toContain("bytecode order file");
          expect(piped.exitCode).toBe(0);
          expect(hasLinkedPayload(exe("piped"))).toBe(true);
          expect(await run(exe("piped"), recordedArgv)).toEqual(plain);
          expect(await stats(exe("piped"), recordedArgv)).toMatchObject({
            hot: expect.any(Number),
            unknown: 0,
            cold: 0,
          });
        },
        60_000,
      );
    });

    // process.kill(process.pid, signal) with no handler ends the process without the usual exit: the recording is written
    // before the signal is sent, like the profiles and the compile cache.
    describe.skipIf(isWindows)("a process that sends itself a fatal signal still writes the order file", () => {
      let selfKillDir: ReturnType<typeof tempDir> | undefined;
      let built: string;
      afterAll(() => selfKillDir?.[Symbol.dispose]());
      beforeAll(async () => {
        selfKillDir = tempDir("build-compile-bytecode-order-self-kill", {
          "app.js": `
            function used() {
              return "ran";
            }
            console.log(used());
            const signal = process.argv[2];
            if (process.argv[3] === "from its handler") {
              // What a CLI does on Ctrl-C: clean up in a handler, then let the signal end the process after all.
              process.on(signal, function handler() {
                process.off(signal, handler);
                process.kill(process.pid, signal);
              });
            }
            process.kill(process.pid, signal);
            // Still here: the signal was one that does not end the process, and what runs now is recorded too.
            await new Promise(resolve => setImmediate(resolve));
            const after = () => "after";
            console.log(after());
            if (signal !== "SIGWINCH") setInterval(() => {}, 1000);
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "app.js", "--outfile", exe("app")],
          env: bunEnv,
          cwd: String(selfKillDir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stderr: stderr.includes("error"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
        built = String(selfKillDir);
      }, 120_000);

      // A signal that does not end the process does not end the recording either: the file is written at the real exit.
      test.concurrent(
        "SIGWINCH: the recording goes on",
        async () => {
          const dir = built;
          const record = async (argv: string[], name: string) => {
            await using proc = Bun.spawn({
              cmd: [join(dir, exe("app")), ...argv],
              env: { ...bunEnv, BUN_BYTECODE_ORDER_OUT: join(dir, name) },
              stdout: "pipe",
              stderr: "pipe",
            });
            const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            const lines = (await Bun.file(join(dir, name)).text()).split("\n");
            return { stdout, exitCode, decoded: lines.filter(line => line.startsWith("F ")).length };
          };
          const winch = await record(["SIGWINCH"], "SIGWINCH.order");
          expect({ stdout: winch.stdout, exitCode: winch.exitCode }).toEqual({ stdout: "ran\nafter\n", exitCode: 0 });
          // One more function than a run that ends at the signal: the one that ran after it.
          const term = await record(["SIGTERM"], "SIGTERM-compared.order");
          expect(winch.decoded).toBeGreaterThan(term.decoded);
        },
        60_000,
      );

      describe.each(["SIGINT", "SIGTERM"] as const)("%s", signal => {
        // "on a terminal": Bun then has a handler of its own for the signal (it restores the terminal and lets the
        // signal end the process), which is where a recording is usually made from.
        test.concurrent.each(["directly", "from its handler", "directly, on a terminal"] as const)(
          "sent %s: the recording is there",
          async how => {
            const dir = built;
            const out = join(dir, `${signal}-${how.replaceAll(" ", "-")}.order`);
            const onTerminal = how.endsWith("on a terminal");
            await using proc = Bun.spawn({
              cmd: [join(dir, exe("app")), signal, how],
              env: { ...bunEnv, BUN_BYTECODE_ORDER_OUT: out },
              ...(onTerminal ? { terminal: { data() {} } } : { stdout: "pipe", stderr: "pipe" }),
            });
            if (onTerminal) await proc.exited;
            else await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            proc.terminal?.close();
            expect(proc.signalCode).toBe(signal);
            const lines = (await Bun.file(out).text()).split("\n");
            expect(lines[0]).toBe("v2");
            expect(lines.filter(line => line.startsWith("F ")).length).toBeGreaterThan(0);
            expect(lines.filter(line => line.startsWith("M ")).length).toBeGreaterThan(0);
          },
          60_000,
        );
      });
    });

    // Internal modules the app imports are modules of the link like the app's chunks: recorded, laid out by the file, and
    // loaded from the payload. "cross": their sources come out of the target executable (this same bun under another
    // version, so the result still runs here). One recording, from an unordered build, for both.
    const internalsApp = `import { join } from "node:path";
import http from "node:http";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
import { bytecodeOrderStats } from "bun:jsc";
const server = http.createServer(() => {});
console.log(JSON.stringify({ joined: join("a", "b"), fromBytecode: internalModulesLoadedFromBytecode(), stats: bytecodeOrderStats() }));
server.close();`;
    const runInternals = async (outfile: string, env: Record<string, string> = {}) => {
      await using proc = Bun.spawn({ cmd: [outfile], env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout.trim()) as {
        joined: string;
        fromBytecode: number;
        stats: null | { hot: number; cold: number };
      };
    };
    describe("internal modules in an ordered build", () => {
      let internalsDir: ReturnType<typeof tempDir> | undefined;
      let internalsRecorded: { directory: string; order: string; unordered: { joined: string; fromBytecode: number } };
      afterAll(() => internalsDir?.[Symbol.dispose]());
      beforeAll(async () => {
        internalsDir = tempDir("build-compile-bytecode-order-internals", { "app.js": internalsApp });
        const directory = String(internalsDir);
        const outfile = join(directory, exe("unordered"));
        const result = await Bun.build({
          entrypoints: [join(directory, "app.js")],
          compile: { outfile },
          bytecode: true,
          format: "esm",
          target: "bun",
        });
        expect(result.success).toBe(true);
        const order = join(directory, "app.order");
        const { joined, fromBytecode, stats } = await runInternals(outfile, { BUN_BYTECODE_ORDER_OUT: order });
        expect(stats).toBeNull();
        internalsRecorded = { directory, order, unordered: { joined, fromBytecode } };
      }, 120_000);

      test.each(["host", "cross"] as const)(
        "%s target",
        async mode => {
          const { directory, order, unordered } = internalsRecorded;
          // The recording lists far more than the app's own code: the internal modules' functions, used and not.
          const lines = (await Bun.file(order).text()).split("\n");
          expect(lines.filter(line => line.startsWith("F ")).length).toBeGreaterThan(50);
          expect(lines.filter(line => line.startsWith("K ")).length).toBeGreaterThan(50);

          const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
          const cross =
            mode === "cross"
              ? {
                  target: `bun-${os}-${isArm64 ? "aarch64" : "x64"}${isMusl ? "-musl" : ""}-v1.0.0` as any,
                  executablePath: process.execPath,
                }
              : {};
          const outfile = join(directory, exe("ordered-" + mode));
          const result = await Bun.build({
            entrypoints: [join(directory, "app.js")],
            compile: { outfile, bytecodeOrder: order, ...cross },
            bytecode: true,
            format: "esm",
            target: "bun",
          });
          expect(result.success).toBe(true);
          expect(hasLinkedPayload(outfile)).toBe(true);
          const { joined, fromBytecode, stats } = await runInternals(outfile);
          expect({ joined, fromBytecode }).toEqual(unordered);
          expect(fromBytecode).toBeGreaterThan(10);
          // The app has one function of its own: these are the internal modules' functions, out of the hot region.
          expect(stats!.hot).toBeGreaterThan(50);
          expect(stats!.cold).toBeLessThan(stats!.hot / 4);
        },
        60_000,
      );

      // Every internal module an application can import, and what those depend on. A module of this executable that
      // the parser that names code did not take, or whose text was not ASCII (it is Latin-1 to JavaScriptCore), would
      // have no names; a function that JavaScriptCore has and the names do not is a warning of the build.
      test("every internal module's functions have names", async () => {
        const { directory, order } = internalsRecorded;
        const specifiers = [
          ...builtinModules.filter(name => !name.startsWith("bun:") && name !== "bun"),
          "bun:sqlite",
          "bun:ffi",
          "bun:jsc",
        ];
        // (Not every builtin module is an internal module: some are native.)
        const named = specifiers
          .map(specifier => (specifier.includes(":") ? specifier : "node:" + specifier))
          .map(specifier => [specifier, bytecodeOrderNames(specifier, "internal")] as const)
          .filter(([, names]) => names !== undefined)
          .map(([specifier, names]) => [specifier, names?.split("\n").length ?? 0] as const);
        expect(named.length).toBeGreaterThan(30);
        expect(named.filter(([, functions]) => functions < 2)).toEqual([]);
        await Bun.write(
          join(directory, "every.js"),
          specifiers.map((specifier, i) => `import * as m${i} from ${JSON.stringify(specifier)};`).join("\n") +
            `\nconsole.log(${specifiers.map((_, i) => `typeof m${i}`).join(", ")});`,
        );
        const result = await Bun.build({
          entrypoints: [join(directory, "every.js")],
          compile: { outfile: join(directory, exe("every")), bytecodeOrder: order },
          bytecode: true,
          format: "esm",
          target: "bun",
        });
        expect(result.logs.map(log => log.message).filter(message => message.includes("no names"))).toEqual([]);
        expect(result.success).toBe(true);
        expect(hasLinkedPayload(join(directory, exe("every")))).toBe(true);
      }, 120_000);

      // An executable whose trailer says "one linked payload" and whose payload record does not check out (someone
      // edited it) has no bytecode at all: an internal module's entry, like a module's, refers to what lies before it
      // in the payload and cannot be decoded as a payload of its own. (Linux: elsewhere the edit breaks the signature.)
      test.skipIf(!isLinux)(
        "a payload record that does not check out",
        async () => {
          const { directory, order, unordered } = internalsRecorded;
          const outfile = join(directory, exe("edited"));
          const result = await Bun.build({
            entrypoints: [join(directory, "app.js")],
            compile: { outfile, bytecodeOrder: order },
            bytecode: true,
            format: "esm",
            target: "bun",
          });
          expect(result.success).toBe(true);
          expect((await runInternals(outfile)).fromBytecode).toBeGreaterThan(10);
          // Where the regions end is no longer sorted.
          const { recordAt, regionEnds } = linkedLayout(outfile);
          const file = readFileSync(outfile);
          file.writeUInt32LE(regionEnds[1] + 1, recordAt + 8);
          writeFileSync(outfile, file);
          const edited = await runInternals(outfile);
          expect({ joined: edited.joined, fromBytecode: edited.fromBytecode }).toEqual({
            joined: unordered.joined,
            fromBytecode: 0,
          });
        },
        60_000,
      );
    });
  });

  // Bytecode is counted among the outputs before it is generated. JSC rejects this regular expression, which the bundler
  // passes through, so that chunk ends up without bytecode: the files after it must still be in the executable.
  test("a chunk whose bytecode cannot be generated keeps the embedded files", async () => {
    using dir = tempDir("build-compile-bytecode-failed", {
      "logo.png": "PNGDATA",
      "data.bin": "BINDATA",
      "index.js": `
          import logo from "./logo.png" with { type: "file" };
          import data from "./data.bin" with { type: "file" };
          console.log(await Bun.file(logo).text(), await Bun.file(data).text());
          try {
            const { bad } = await import("./bad.js");
            console.log(bad("x"));
          } catch (error) {
            console.log(error.name);
          }
        `,
      "bad.js": String.raw`export const bad = s => /\p{NotAProperty}/u.test(s);`,
    });
    const outfile = join(String(dir), isWindows ? "app.exe" : "app");
    const build = await Bun.build({
      entrypoints: [join(String(dir), "index.js")],
      target: "bun",
      format: "esm",
      splitting: true,
      bytecode: true,
      compile: { outfile },
    });
    expect(build.success).toBe(true);
    await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "PNGDATA BINDATA\nSyntaxError\n", stderr: "" });
    expect(exitCode).toBe(0);
  }, 60_000);

  // --bytecode into an executable for another os/arch/libc embeds bytecode written by this platform's JavaScriptCore for
  // another's; such executables say so in crash reports (Features: cross_compiled_bytecode). The "other platform" build
  // here is the same OS with the other CPU, and reuses this bun as the target executable, so it still runs here.
  const otherPlatform = `bun-${isLinux ? "linux" : isMacOS ? "darwin" : "windows"}-${isArm64 ? "x64" : "aarch64"}${isMusl ? "-musl" : ""}`;
  test.each([
    ["this platform", undefined as string | undefined, false],
    [otherPlatform, otherPlatform, true],
  ])("--compile --bytecode for %s", async (_label, target, expected) => {
    using dir = tempDir("build-compile-cross-bytecode", {
      "app.js": `require("bun:internal-for-testing").crash_handler.panic();`,
    });
    const outfile = join(dir + "", isWindows ? "app.exe" : "app");
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        ...(target ? [`--target=${target}`, `--compile-executable-path=${process.execPath}`] : []),
        join(dir + "", "app.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    await using proc = Bun.spawn({
      cmd: [outfile],
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    // (stdout is not asserted: ASAN builds print the symbolized crash trace there.)
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("panic");
    expect(stderr.includes("cross_compiled_bytecode")).toBe(expected);
    expect(exitCode).not.toBe(0);
  });

  // "cross": the target is not the host, so the internal modules' sources, ids and stamp are read out of the target
  // executable's builtins section (here: this same bun under a different version, so the result still runs locally).
  test.each([false, true, "cross" as const])(
    "--bytecode=%p: internal modules the app imports come from embedded bytecode",
    async mode => {
      const bytecode = mode !== false;
      const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
      const cross =
        mode === "cross"
          ? {
              target: `bun-${os}-${isArm64 ? "aarch64" : "x64"}${isMusl ? "-musl" : ""}-v1.0.0` as any,
              executablePath: process.execPath,
            }
          : {};
      using dir = tempDir("build-compile-builtin-bytecode", {
        "app.js": `import { join } from "node:path";
import http from "node:http";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
const server = http.createServer(() => {});
console.log(JSON.stringify({ joined: join("a", "b"), fromBytecode: internalModulesLoadedFromBytecode() }));
server.close();`,
      });
      const outfile = join(dir + "", "app");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile, ...cross },
        bytecode,
        format: "esm",
        target: "bun",
      });
      expect(result.success).toBe(true);
      await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { joined, fromBytecode } = JSON.parse(stdout.trim());
      expect(joined).toBe(join("a", "b"));
      if (bytecode) {
        // node:path, node:http and what they require at load (node:net, node:events, the stream internals, ...).
        expect(fromBytecode).toBeGreaterThan(10);
      } else {
        expect(fromBytecode).toBe(0);
      }
      expect(exitCode).toBe(0);
    },
    // A --compile build plus (for "cross") bytecode for ~45 internal modules: ~10s under debug+ASAN.
    60_000,
  );

  test("compile with invalid target fails gracefully", async () => {
    using dir = tempDir("build-compile-invalid", {
      "index.js": `console.log("test");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: [join(dir, "index.js")],
        compile: {
          target: "bun-invalid-platform",
          outfile: join(dir, "invalid-app"),
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"Unknown compile target: bun-invalid-platform"`);
  });

  // One compile per test: each compile copies the whole bun binary (~1 GB under debug+ASAN),
  // which by itself takes a good part of the default per-test timeout.
  test.each(["output/nested/app1", "app2", "a/b/c/d/app3"])(
    "compile writes the executable to outfile %s",
    async relativeOutfile => {
      using dir = tempDir("build-compile-outfile", {
        "app.js": `console.log("Testing outfile paths");`,
      });
      const outfile = join(String(dir), relativeOutfile);

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        compile: { outfile },
      });

      expect(result.success).toBe(true);
      expect(result.outputs.map(output => output.path)).toEqual([isWindows ? `${outfile}.exe` : outfile]);
      expect(await Bun.file(result.outputs[0].path).exists()).toBe(true);
    },
  );

  test("compile without outfile writes the executable to the working directory", async () => {
    using dir = tempDir("build-compile-default-outfile", {
      "proj/sub/myapp.ts": `console.log("default outfile");`,
      "cwd/build.ts": `
        const result = await Bun.build({
          entrypoints: [process.argv[2]],
          compile: true,
        });
        console.log(JSON.stringify(result.outputs.map(output => output.path)));
      `,
    });
    const cwd = join(String(dir), "cwd");
    const entrypoint = join(String(dir), "proj", "sub", "myapp.ts");
    const name = isWindows ? "myapp.exe" : "myapp";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts", entrypoint],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The name comes from the entrypoint. The directory is the working directory, like `bun build --compile`.
    expect(JSON.parse(stdout)).toEqual([join(cwd, name)]);
    expect(exitCode).toBe(0);

    expect(await Bun.file(join(cwd, name)).exists()).toBe(true);
    expect(await Bun.file(join(String(dir), "proj", "sub", name)).exists()).toBe(false);

    await using app = Bun.spawn({
      cmd: [join(cwd, name)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [appStdout, appStderr, appExitCode] = await Promise.all([app.stdout.text(), app.stderr.text(), app.exited]);
    expect(appStdout).toBe("default outfile\n");
    expect(appStderr).toBe("");
    expect(appExitCode).toBe(0);
  });

  test("compile with embedded resources uses correct module prefix", async () => {
    using dir = tempDir("build-compile-embedded-resources", {
      "app.js": `
        // This test verifies that embedded resources use the correct target-specific base path
        // The module prefix should be set to the target's base path 
        // not the user-configured public_path
        import { readFileSync } from 'fs';
        
        // Try to read a file that would be embedded in the standalone executable
        try {
          const embedded = readFileSync('embedded.txt', 'utf8');
          console.log('Embedded file:', embedded);
        } catch (e) {
          console.log('Reading embedded file');
        }
      `,
      "embedded.txt": "This is an embedded resource",
    });

    // Test with default target (current platform)
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: "app-with-resources",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-with-resources.exe" : "app-with-resources");

    // The test passes if compilation succeeds - the actual embedded resource
    // path handling is verified by the successful compilation
  });
});

describe("compiled binary validity", () => {
  test("output binary has valid executable header", async () => {
    using dir = tempDir("build-compile-valid-header", {
      "app.js": `console.log("hello");`,
    });

    const outfile = join(dir + "", "app-out");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    // Read the first 4 bytes and verify it's a valid executable magic number
    const file = Bun.file(result.outputs[0].path);
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());

    if (isMacOS) {
      // MachO magic: 0xCFFAEDFE (little-endian)
      expect(header[0]).toBe(0xcf);
      expect(header[1]).toBe(0xfa);
      expect(header[2]).toBe(0xed);
      expect(header[3]).toBe(0xfe);
    } else if (isLinux) {
      // ELF magic: 0x7F 'E' 'L' 'F'
      expect(header[0]).toBe(0x7f);
      expect(header[1]).toBe(0x45); // 'E'
      expect(header[2]).toBe(0x4c); // 'L'
      expect(header[3]).toBe(0x46); // 'F'
    } else if (isWindows) {
      // PE magic: 'M' 'Z'
      expect(header[0]).toBe(0x4d); // 'M'
      expect(header[1]).toBe(0x5a); // 'Z'
    }
  });

  test("compiled binary runs and produces expected output", async () => {
    using dir = tempDir("build-compile-runs", {
      "app.js": `console.log("compile-test-output");`,
    });

    const outfile = join(dir + "", "app-run");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [result.outputs[0].path],
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("compile-test-output");
    expect(exitCode).toBe(0);
  });
});

if (isLinux) {
  describe("ELF section", () => {
    test("compiled binary runs with execute-only permissions", async () => {
      using dir = tempDir("build-compile-exec-only", {
        "app.js": `console.log("exec-only-output");`,
      });

      const outfile = join(dir + "", "app-exec-only");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      chmodSync(result.outputs[0].path, 0o111);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("exec-only-output");
      expect(exitCode).toBe(0);
    });

    test("compiled binary with large payload runs correctly", async () => {
      // Generate a string payload >16KB to exceed the initial .bun section allocation
      // (BUN_COMPILED is aligned to 16KB). This forces the expansion path in elf.zig
      // which appends data to the end of the file and extends the writable PT_LOAD
      // to cover it.
      const largeString = Buffer.alloc(20000, "x").toString();
      using dir = tempDir("build-compile-large-payload", {
        "app.js": `const data = "${largeString}"; console.log("large-payload-" + data.length);`,
      });

      const outfile = join(dir + "", "app-large");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("large-payload-20000");
      expect(exitCode).toBe(0);
    });

    test("compiled binary with large payload runs with execute-only permissions", async () => {
      // Same as above but also verifies execute-only works with the expansion path
      const largeString = Buffer.alloc(20000, "y").toString();
      using dir = tempDir("build-compile-large-exec-only", {
        "app.js": `const data = "${largeString}"; console.log("large-exec-only-" + data.length);`,
      });

      const outfile = join(dir + "", "app-large-exec-only");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      chmodSync(result.outputs[0].path, 0o111);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("large-exec-only-20000");
      expect(exitCode).toBe(0);
    });

    test("compiled binary has .bun ELF section", async () => {
      using dir = tempDir("build-compile-elf-section", {
        "app.js": `console.log("elf-section-test");`,
      });

      const outfile = join(dir + "", "app-elf-section");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      // Verify .bun ELF section exists by reading section headers
      const file = Bun.file(result.outputs[0].path);
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Parse ELF header to find section headers
      const view = new DataView(bytes.buffer);
      // e_shoff at offset 40 (little-endian u64)
      const shoff = Number(view.getBigUint64(40, true));
      // e_shentsize at offset 58
      const shentsize = view.getUint16(58, true);
      // e_shnum at offset 60
      const shnum = view.getUint16(60, true);
      // e_shstrndx at offset 62
      const shstrndx = view.getUint16(62, true);

      // Read .shstrtab section header to get string table
      const strtabOff = shoff + shstrndx * shentsize;
      const strtabFileOffset = Number(view.getBigUint64(strtabOff + 24, true));
      const strtabSize = Number(view.getBigUint64(strtabOff + 32, true));

      const decoder = new TextDecoder();
      let foundBunSection = false;
      for (let i = 0; i < shnum; i++) {
        const hdrOff = shoff + i * shentsize;
        const nameIdx = view.getUint32(hdrOff, true);
        if (nameIdx < strtabSize) {
          // Read null-terminated string from strtab
          let end = strtabFileOffset + nameIdx;
          while (end < bytes.length && bytes[end] !== 0) end++;
          const name = decoder.decode(bytes.slice(strtabFileOffset + nameIdx, end));
          if (name === ".bun") {
            foundBunSection = true;
            // Verify the section has non-zero size
            const shSize = Number(view.getBigUint64(hdrOff + 32, true));
            expect(shSize).toBeGreaterThan(0);
            break;
          }
        }
      }
      expect(foundBunSection).toBe(true);
    });

    // Regression guard for #29963. WSL1's kernel ELF loader rejects `execve`
    // with ENOEXEC when it sees a late PT_LOAD produced by repurposing
    // PT_GNU_STACK. The compiled binary must instead:
    //
    //   1. Keep PT_GNU_STACK in the program header table (not repurposed).
    //   2. Fit the .bun payload inside an existing writable PT_LOAD's
    //      `[p_vaddr, p_vaddr + p_memsz)` range — i.e. the writable segment
    //      was GROWN to cover .bun rather than a new segment being added.
    //
    // The gate here is purely structural (we check the ELF layout); we don't
    // need a WSL1 host to validate the fix.
    //
    // Higher per-test timeout because `bun build --compile` copies + rewrites
    // the entire bun binary (~1GB under debug+ASAN), which blows the 5s
    // default.
    test("compiled binary preserves PT_GNU_STACK and no late PT_LOAD for .bun (#29963)", async () => {
      // Use a small payload — the shape check matters for all sizes but a
      // bigger payload guarantees the expansion path actually runs.
      const largeString = Buffer.alloc(20000, "z").toString();
      using dir = tempDir("build-compile-wsl1-regression", {
        "app.js": `const data = "${largeString}"; console.log("wsl1-regression-" + data.length);`,
      });

      const outfile = join(dir + "", "app-wsl1-regression");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile },
      });
      expect(result.success).toBe(true);

      const bytes = new Uint8Array(await Bun.file(result.outputs[0].path).arrayBuffer());
      const view = new DataView(bytes.buffer);

      // ELF64 header layout:
      //   e_phoff @ 32 (u64), e_phentsize @ 54 (u16), e_phnum @ 56 (u16)
      const phoff = Number(view.getBigUint64(32, true));
      const phentsize = view.getUint16(54, true);
      const phnum = view.getUint16(56, true);
      expect(phentsize).toBe(56); // sizeof(Elf64_Phdr)

      // Elf64_Phdr layout:
      //   p_type @ 0 (u32), p_flags @ 4 (u32), p_offset @ 8 (u64),
      //   p_vaddr @ 16 (u64), p_paddr @ 24 (u64),
      //   p_filesz @ 32 (u64), p_memsz @ 40 (u64), p_align @ 48 (u64)
      const PT_LOAD = 1;
      const PT_GNU_STACK = 0x6474e551;
      const PF_W = 2;

      // Locate .bun's vaddr by walking section headers.
      const shoff = Number(view.getBigUint64(40, true));
      const shentsize = view.getUint16(58, true);
      const shnum = view.getUint16(60, true);
      const shstrndx = view.getUint16(62, true);
      const strtabHdr = shoff + shstrndx * shentsize;
      const strtabOff = Number(view.getBigUint64(strtabHdr + 24, true));
      const strtabSize = Number(view.getBigUint64(strtabHdr + 32, true));
      const decoder = new TextDecoder();
      let bunAddr = 0n;
      let bunSize = 0n;
      for (let i = 0; i < shnum; i++) {
        const hdrOff = shoff + i * shentsize;
        const nameIdx = view.getUint32(hdrOff, true);
        if (nameIdx >= strtabSize) continue;
        let end = strtabOff + nameIdx;
        while (end < bytes.length && bytes[end] !== 0) end++;
        const name = decoder.decode(bytes.slice(strtabOff + nameIdx, end));
        if (name === ".bun") {
          bunAddr = view.getBigUint64(hdrOff + 16, true); // sh_addr
          bunSize = view.getBigUint64(hdrOff + 32, true); // sh_size
          break;
        }
      }
      expect(bunAddr).not.toBe(0n);
      expect(bunSize).toBeGreaterThan(0n);

      // Walk program headers: count PT_LOADs, require PT_GNU_STACK to still
      // be present, and find the writable PT_LOAD containing .bun.
      let hasGnuStack = false;
      let loadCount = 0;
      let writableLoadCoversBun = false;
      for (let i = 0; i < phnum; i++) {
        const off = phoff + i * phentsize;
        const pType = view.getUint32(off, true);
        const pFlags = view.getUint32(off + 4, true);
        const pVaddr = view.getBigUint64(off + 16, true);
        const pMemsz = view.getBigUint64(off + 40, true);

        if (pType === PT_GNU_STACK) hasGnuStack = true;
        if (pType === PT_LOAD) {
          loadCount++;
          if ((pFlags & PF_W) !== 0 && pVaddr <= bunAddr && bunAddr + bunSize <= pVaddr + pMemsz) {
            writableLoadCoversBun = true;
          }
        }
      }

      // #29963: PT_GNU_STACK must NOT be repurposed into a PT_LOAD.
      expect(hasGnuStack).toBe(true);
      // #29963: the writable PT_LOAD must have been grown to cover .bun,
      // rather than a new late PT_LOAD being appended.
      expect(writableLoadCoversBun).toBe(true);
      // A stock bun has 3 PT_LOAD segments; the fix must not add a 4th.
      expect(loadCount).toBe(3);
      // JSC bytecode cache requires 128-byte-aligned deserialization input.
      // StandaloneModuleGraph writes bytecode at payload offset 120 assuming
      // the `[u64 size]` header sits at a 128-byte-aligned vaddr (so bytecode
      // lands at vaddr + 8 + 120, which is 128-aligned). A new_vaddr that
      // inherits the RW segment's non-128 residue SIGSEGVs JSC on aarch64.
      expect(bunAddr % 128n).toBe(0n);

      // Sanity: the binary still runs and produces the expected output.
      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toContain("wsl1-regression-20000");
      expect(exitCode).toBe(0);
    }, 60_000);

    // Regression guard for #31023. On NixOS, `autoPatchelfHook` runs
    // `patchelf --set-interpreter` on the installed bun binary. Patchelf
    // inserts a *new* writable PT_LOAD at the front of the program-header
    // table (to hold the relocated PHDR + .interp), so the template bun
    // has TWO writable PT_LOADs. `write_bun_section` used to pick the
    // first writable PT_LOAD and extend it — that's patchelf's small
    // segment, unrelated to .bun — producing an output whose grown
    // segment overlaps the read-only and executable PT_LOADs at
    // conflicting vaddrs. The kernel ELF loader mmap'd garbage over .bun
    // at its runtime address and the compiled binary segfaulted on exec.
    //
    // We simulate the NixOS layout by running `patchelf
    // --set-interpreter` on the bun binary (exactly what
    // autoPatchelfHook does) and then using `--compile-executable-path`
    // to drive `bun build --compile` off it. The resulting output must
    // (a) have the .bun section inside a writable PT_LOAD whose extent
    // doesn't cross another PT_LOAD, and (b) actually run.
    const patchelf = Bun.which("patchelf");
    const ldso =
      process.arch === "arm64"
        ? isMusl
          ? "/lib/ld-musl-aarch64.so.1"
          : "/lib/ld-linux-aarch64.so.1"
        : isMusl
          ? "/lib/ld-musl-x86_64.so.1"
          : "/lib64/ld-linux-x86-64.so.2";

    // Mirror of `hostUsesNixStoreInterpreter()` in src/exe_format/elf.rs:
    // gate out NixOS/Guix hosts where the FHS ldso path is a stub that
    // refuses to exec generic binaries. Without this the final
    // `Bun.spawn({cmd:[outfile]})` check fails on a NixOS host because
    // stub-ld rejects the compiled output, not because the fix is broken.
    // Same pattern as the sibling patchelf tests in
    // test/regression/issue/29290.test.ts and 24742.test.ts.
    function readInterp(buf: Buffer): string | null {
      if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) return null;
      const e_phoff = Number(buf.readBigUInt64LE(32));
      const e_phnum = buf.readUInt16LE(56);
      for (let i = 0; i < e_phnum; i++) {
        const ph = e_phoff + i * 56;
        if (buf.readUInt32LE(ph) !== 3 /* PT_INTERP */) continue;
        const p_offset = Number(buf.readBigUInt64LE(ph + 8));
        const p_filesz = Number(buf.readBigUInt64LE(ph + 32));
        const region = buf.subarray(p_offset, p_offset + p_filesz);
        const nul = region.indexOf(0);
        return region.subarray(0, nul === -1 ? region.length : nul).toString("utf8");
      }
      return null;
    }
    function hostLooksNix(): boolean {
      if (existsSync("/etc/NIXOS")) return true;
      if (existsSync("/gnu/store")) return true;
      try {
        // bun is ~1 GB in debug builds; PT_INTERP lives in the first page,
        // so read only the leading 4 KiB.
        const fd = openSync(bunExe(), "r");
        try {
          const buf = Buffer.alloc(4096);
          const n = readSync(fd, buf, 0, 4096, 0);
          const selfInterp = readInterp(buf.subarray(0, n));
          if (selfInterp && (selfInterp.startsWith("/nix/store/") || selfInterp.startsWith("/gnu/store/"))) {
            return true;
          }
        } finally {
          closeSync(fd);
        }
      } catch {}
      return false;
    }

    test.skipIf(!patchelf || !existsSync(ldso) || hostLooksNix())(
      "compiled binary works when template bun has patchelf-inserted RW PT_LOAD (#31023)",
      async () => {
        using dir = tempDir("build-compile-patchelf-rw-regression", {
          "app.js": `console.log("patchelf-regression-ok");`,
        });
        const cwd = String(dir);

        // Copy bun and patchelf it — autoPatchelfHook's signature move.
        // Any real interpreter works; we just need patchelf to insert its
        // new writable PT_LOAD at the front of the phdr table.
        const patchedBun = join(cwd, "patched-bun");
        cpSync(bunExe(), patchedBun);
        chmodSync(patchedBun, 0o755);
        {
          const r = Bun.spawnSync({
            cmd: [patchelf!, "--set-interpreter", ldso, patchedBun],
            stderr: "pipe",
          });
          expect(r.stderr.toString()).toBe("");
          expect(r.exitCode).toBe(0);
        }

        // Sanity: the patched bun really does have two writable PT_LOADs.
        // Otherwise the test is vacuous (it would exercise the same path
        // as the stock-bun tests above).
        {
          const bytes = new Uint8Array(await Bun.file(patchedBun).arrayBuffer());
          const view = new DataView(bytes.buffer);
          const phoff = Number(view.getBigUint64(32, true));
          const phentsize = view.getUint16(54, true);
          const phnum = view.getUint16(56, true);
          let writableLoads = 0;
          for (let i = 0; i < phnum; i++) {
            const off = phoff + i * phentsize;
            const pType = view.getUint32(off, true);
            const pFlags = view.getUint32(off + 4, true);
            if (pType === 1 /* PT_LOAD */ && (pFlags & 2) !== 0 /* PF_W */) writableLoads++;
          }
          expect(writableLoads).toBeGreaterThanOrEqual(2);
        }

        // Drive bun build --compile off the patched template.
        const outfile = join(cwd, "app-out");
        const build = Bun.spawnSync({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--compile-executable-path",
            patchedBun,
            join(cwd, "app.js"),
            "--outfile",
            outfile,
          ],
          env: bunEnv,
          cwd,
          stderr: "pipe",
          stdout: "pipe",
        });
        expect(build.stderr.toString()).not.toContain("error:");
        expect(build.exitCode).toBe(0);

        // Structural check on the output: the writable PT_LOAD that
        // contains .bun must not overlap any other PT_LOAD. Before the
        // fix, the grown front PT_LOAD extended past the R and R-E
        // PT_LOADs, which is exactly the corruption that segfaulted.
        const bytes = new Uint8Array(await Bun.file(outfile).arrayBuffer());
        const view = new DataView(bytes.buffer);
        const phoff = Number(view.getBigUint64(32, true));
        const phentsize = view.getUint16(54, true);
        const phnum = view.getUint16(56, true);
        const shoff = Number(view.getBigUint64(40, true));
        const shentsize = view.getUint16(58, true);
        const shnum = view.getUint16(60, true);
        const shstrndx = view.getUint16(62, true);
        const strtabHdr = shoff + shstrndx * shentsize;
        const strtabOff = Number(view.getBigUint64(strtabHdr + 24, true));
        const strtabSize = Number(view.getBigUint64(strtabHdr + 32, true));

        // Find .bun's vaddr.
        const decoder = new TextDecoder();
        let bunAddr = 0n;
        for (let i = 0; i < shnum; i++) {
          const hdrOff = shoff + i * shentsize;
          const nameIdx = view.getUint32(hdrOff, true);
          if (nameIdx >= strtabSize) continue;
          let end = strtabOff + nameIdx;
          while (end < bytes.length && bytes[end] !== 0) end++;
          const name = decoder.decode(bytes.slice(strtabOff + nameIdx, end));
          if (name === ".bun") {
            bunAddr = view.getBigUint64(hdrOff + 16, true);
            break;
          }
        }
        expect(bunAddr).not.toBe(0n);

        // Collect all PT_LOAD ranges; find the one that covers .bun and
        // assert it doesn't overlap any of the others.
        type LoadSeg = { vaddr: bigint; end: bigint; writable: boolean };
        const loads: LoadSeg[] = [];
        for (let i = 0; i < phnum; i++) {
          const off = phoff + i * phentsize;
          if (view.getUint32(off, true) !== 1 /* PT_LOAD */) continue;
          const pFlags = view.getUint32(off + 4, true);
          const pVaddr = view.getBigUint64(off + 16, true);
          const pMemsz = view.getBigUint64(off + 40, true);
          loads.push({ vaddr: pVaddr, end: pVaddr + pMemsz, writable: (pFlags & 2) !== 0 });
        }
        const bunLoadIdx = loads.findIndex(s => s.writable && s.vaddr <= bunAddr && bunAddr < s.end);
        expect(bunLoadIdx).toBeGreaterThanOrEqual(0);
        const bunLoad = loads[bunLoadIdx];
        for (let i = 0; i < loads.length; i++) {
          if (i === bunLoadIdx) continue;
          const other = loads[i];
          // Disjoint: either bunLoad ends before other starts, or other
          // ends before bunLoad starts.
          const disjoint = bunLoad.end <= other.vaddr || other.end <= bunLoad.vaddr;
          expect(disjoint).toBe(true);
        }

        // And the binary actually runs — the ultimate behavioral check.
        await using proc = Bun.spawn({
          cmd: [outfile],
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout.trim()).toBe("patchelf-regression-ok");
        expect(exitCode).toBe(0);
      },
      180_000,
    );
  });
}

// Regression guard for the standalone-module-graph ELF probe on Android.
//
// Spec: src/standalone_graph/StandaloneModuleGraph.zig — `fromExecutable()`
// gates the ELF `.bun` reader on `Environment.isLinux or Environment.isFreeBSD`.
// Zig's `isLinux` (builtin.target.os.tag == .linux) is TRUE on Android, so
// Android takes the ELF path and the trailing `comptime unreachable` is dead.
//
// In Rust, `target_os = "linux"` and `target_os = "android"` are distinct cfg
// values. A naive port of the Zig gate as
//   #[cfg(any(target_os = "linux", target_os = "freebsd"))]
// silently excludes Android and falls through to the catch-all
// `unreachable!()`, so every `bun build --compile` binary panics at startup
// on Android instead of loading its embedded module graph.
//
// This test only runs on an Android host. It compiles a trivial app and
// asserts the resulting binary starts, finds its graph, and runs the entry —
// i.e. the ELF arm was taken, not `unreachable!()`.
if (process.platform === "android") {
  describe("ELF section (Android)", () => {
    test("compiled standalone binary loads its module graph on Android", async () => {
      using dir = tempDir("build-compile-android-elf", {
        "app.js": `console.log("android-standalone-ok");`,
      });

      const outfile = join(String(dir), "app-android");

      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      await using proc = Bun.spawn({
        cmd: [outfile],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // If the Rust cfg-gate diverges from Zig's `Environment.isLinux`, the
      // process panics with `internal error: entered unreachable code` before
      // any user JS runs. Assert the spec behavior: graph found, entry ran.
      expect(stderr).not.toContain("unreachable");
      expect(stdout.trim()).toBe("android-standalone-ok");
      expect(exitCode).toBe(0);
    }, 60_000);
  });
}

// A compiled executable launched from a directory that has been removed
// starts like any other program (and like `node app.js`): the executable's
// directory stands in for the unreadable one, and `process.cwd()` reports the
// error if the program asks. It once segfaulted here, and later refused to
// start; one built with `--compile-exec-argv` takes a different startup path
// (`Arguments::parse`) and must behave the same.
//
// POSIX-only: a process can keep a deleted directory as its cwd until the last
// fd to it closes, whereas Windows refuses to remove a directory that is any
// process's cwd — so the scenario is unreachable there. The cwd has to be
// removed AFTER the process starts, which `Bun.spawn`'s `cwd` can't do, so a
// shell wrapper `cd`s in, `rmdir`s, then execs the binary (how a user hits it).
describe("compiled binary in a deleted cwd", () => {
  test.concurrent.skipIf(!isPosix).each([[[]], [["--compile-exec-argv=--smol"]]])(
    "starts, and process.cwd() reports the error (extra build flags: %j)",
    async extraFlags => {
      using dir = tempDir("build-compile-deleted-cwd", {
        "app.js": `let code; try { process.cwd(); } catch (e) { code = e.code; } console.log(JSON.stringify({ ran: true, code }));`,
      });
      const outfile = join(String(dir), "app");

      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", ...extraFlags, join(String(dir), "app.js"), "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      // A fresh directory to stand in and delete — NOT `dir`, which holds the
      // compiled binary we still need to exec.
      using cwdDir = tempDir("build-compile-gone-cwd", {});
      const gone = String(cwdDir);

      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `cd "${gone}" && rmdir "${gone}" && exec "${outfile}"`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ran: true, code: "ENOENT" });
      expect(exitCode).toBe(0);
    },
    60_000,
  );
});

// Every region of the embedded module graph (file contents, names, bytecode, the
// module table) is addressed by a 32-bit offset and length. `to_bytes` used to cast
// every offset with `as u32`, so a graph past 4 GiB was written with wrapped
// offsets: the build succeeded and the executable failed at startup
// (`Module not found ''`) or read the wrong bytes. The build has to fail instead.
//
// Debug builds lower the limit through BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES
// so the test does not need a 4 GiB input. The message still names the real limit.
describe.concurrent("embedded module graph size limit", () => {
  const asset = Buffer.alloc(8 * 1024 * 1024, "x");
  const files = {
    "app.js": `import big from "./big.bin" with { type: "file" };
console.log(require("fs").statSync(big).size);`,
    "big.bin": asset,
  };

  test.skipIf(!isDebug)("build --compile fails when the graph is larger than the offsets can address", async () => {
    using dir = tempDir("build-compile-graph-too-large", files);

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", "app"],
      env: { ...bunEnv, BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES: String(4 * 1024 * 1024) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(stderr).toContain(
      "failed to generate module graph bytes: embedded module graph would exceed 4 GiB (its offsets are 32-bit)",
    );
    expect(exitCode).toBe(1);
    // No executable, not even a partial one.
    expect(readdirSync(String(dir)).sort()).toEqual(["app.js", "big.bin"]);
  });

  test.skipIf(!isDebug)("build --compile still succeeds when the graph fits under the limit", async () => {
    using dir = tempDir("build-compile-graph-fits", files);
    const outfile = join(String(dir), isWindows ? "app.exe" : "app");

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", outfile],
      env: { ...bunEnv, BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES: String(256 * 1024 * 1024) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);

    await using proc = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${asset.byteLength}\n`);
    expect(exitCode).toBe(0);
  });
});

// file command test works well

// `optimize.bytecode: false` / `--no-optimize-bytecode` is the only build that embeds unoptimized bytecode; it must
// keep producing working output.
describe("Bun.build compile optimize", () => {
  const files = {
    "entry.ts": `
      import { a, bump, counter } from "./a";
      import { b } from "./b";
      console.log(a, b, counter);
      bump();
      console.log(counter, (await import("./lazy")).lazy());
    `,
    "a.ts": `
      import { nameB } from "./b";
      export let counter = 0;
      export function bump() { counter++; }
      export function nameA() { return "A"; }
      export const a = "a:" + nameB();
    `,
    "b.ts": `
      import { nameA } from "./a";
      export function nameB() { return "B"; }
      export const b = "b:" + nameA();
    `,
    "lazy.ts": `
      import { counter } from "./a";
      export function lazy() { return "lazy:" + counter; }
    `,
  };
  const expected = "a:B b:A 0\n1 lazy:1\n";

  async function runExe(exe: string) {
    await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  }

  test("optimize.bytecode: false (Bun.build, esm + splitting)", async () => {
    using dir = tempDir("build-compile-optimize-bytecode-off", files);
    const outfile = join(String(dir), "app" + (isWindows ? ".exe" : ""));
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      compile: { outfile },
      bytecode: true,
      format: "esm",
      splitting: true,
      optimize: { bytecode: false },
    });
    expect(result.logs.map(String).join("\n")).toBe("");
    expect(result.success).toBe(true);
    await runExe(outfile);
  });

  test("compile.jitPolicy must be a finite number >= 1", () => {
    using dir = tempDir("build-compile-jit-policy", files);
    for (const jitPolicy of [0, 0.5, NaN, Infinity]) {
      expect(() => Bun.build({ entrypoints: [join(String(dir), "entry.ts")], compile: { jitPolicy } })).toThrow(
        RangeError,
      );
    }
    expect(() =>
      Bun.build({ entrypoints: [join(String(dir), "entry.ts")], compile: { jitPolicy: "8" as unknown as number } }),
    ).toThrow(TypeError);
  });

  test.each([
    ["--no-optimize-bytecode esm", ["--format=esm", "--no-optimize-bytecode"]],
    ["--no-optimize-bytecode cjs", ["--format=cjs", "--no-optimize-bytecode"]],
  ])("%s (CLI)", async (tag, flags) => {
    using dir = tempDir("build-compile-optimize-cli", files);
    const outfile = join(String(dir), "app" + (isWindows ? ".exe" : ""));
    // cjs output has no top-level await.
    const entry = flags.includes("--format=cjs") ? "entry-cjs.ts" : "entry.ts";
    await Bun.write(
      join(String(dir), "entry-cjs.ts"),
      files["entry.ts"].replace('(await import("./lazy")).lazy()', 'require("./lazy").lazy()'),
    );
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", ...flags, entry, "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    await runExe(outfile);
  });

  test("--no-optimize-bytecode without --compile (--outdir)", async () => {
    using dir = tempDir("build-optimize-bytecode-outdir", {
      "index.ts": `const f = (n: number) => n * 2; console.log(f(21));`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--bytecode", "--no-optimize-bytecode", "--target=bun", "index.ts", "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    expect(existsSync(join(String(dir), "out", "index.js.jsc"))).toBe(true);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out", "index.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("42\n");
    expect(exitCode).toBe(0);
  });

  // The bytecode optimizer deletes the jmp that closes a try body once the empty catch has been threaded to the loop
  // header, so that try range falls through into the next one. DFG then has to keep the locals that are live only at
  // the first catch (loop-only state) alive across the call that throws.
  describe("locals live only at a catch inside a loop", () => {
    const fixture = `
      let sink = 0;
      function touch() { sink++; }

      function forOfResultDiscarded(kind) {
        for (let name of ["a", "b"]) {
          try { return JSON.parse(kind === "k" && name === "b" ? "1" : "{bad"), true; } catch {}
        }
        return false;
      }
      function forOfResultUsed(kind) {
        for (let name of ["a", "b"]) {
          try { return JSON.parse(kind === "k" && name === "b" ? "1" : "{bad"); } catch {}
        }
        return false;
      }
      function whileInsideFinally(kind) {
        let n = 0, limit = { value: 3 }, log = [];
        try {
          while (true) {
            n++;
            log.push(n);
            if (n > limit.value) { sink += log.length; break; }
            try { return JSON.parse(kind === "k" && n >= 2 ? "1" : "{bad"), true; } catch {}
          }
        } finally {
          try { touch(); } catch {}
        }
        return false;
      }
      function labelledBreakIntoTry(kind) {
        let result = false, n = 0, limit = { value: 3 }, log = [];
        done: {
          for (;;) {
            n++;
            log.push(n);
            if (n > limit.value) { sink += log.length; break; }
            try { JSON.parse(kind === "k" && n >= 2 ? "1" : "{bad"); result = true; break done; } catch {}
          }
        }
        try { touch(); } catch {}
        return result;
      }
      // Nothing throws when this one goes wrong: the lost local silently becomes NaN.
      let observed = 0;
      function loopOnlyNumber(kind) {
        let result = false, n = 0, doubled = 1;
        done: {
          for (;;) {
            n++;
            doubled = doubled * 2;
            observed = doubled;
            if (n > 3) break;
            try { JSON.parse(kind === "k" && n >= 2 ? "1" : "{bad"); result = true; break done; } catch {}
          }
        }
        try { touch(); } catch {}
        return result + ":" + n + ":" + observed;
      }
      // Inlining the recursive call reaches one exception handler through two inline call frames.
      function recursive(depth) {
        let saved = 0;
        try {
          saved = depth * 3 + 1;
          if (depth > 0) sink += recursive(depth - 1);
          JSON.parse("{bad");
          return -1;
        } catch {
          return saved;
        }
      }
      function forOfFromCaller(kind) { return forOfResultDiscarded(kind); }

      const cases = [
        [forOfResultDiscarded, "true", "false"],
        [forOfResultUsed, "1", "false"],
        [whileInsideFinally, "true", "false"],
        [labelledBreakIntoTry, "true", "false"],
        [loopOnlyNumber, "true:2:4", "false:4:16"],
      ];
      for (let i = 0; i < 300; i++) {
        const hit = i % 3 === 0;
        const kind = hit ? "k" : "x";
        for (const [f, whenHit, whenMiss] of cases) {
          const result = String(f(kind));
          if (result !== (hit ? whenHit : whenMiss)) throw new Error(f.name + ": got " + result + " at " + i);
        }
        if (forOfFromCaller(kind) !== hit) throw new Error("forOfFromCaller: bad result at " + i);
        if (recursive(2) !== 7) throw new Error("recursive: bad result at " + i);
      }
      console.log("ok");
    `;
    // Compile on the main thread so the tier-up points do not depend on scheduling, and reach the DFG after about a
    // hundred calls: every case throws several exceptions per call, which is slow in debug builds. With these settings
    // each case goes wrong within 70 iterations when the locals are lost.
    const jit = {
      BUN_JSC_useConcurrentJIT: "0",
      BUN_JSC_useFTLJIT: "0",
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
      BUN_JSC_thresholdForJITSoon: "10",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "100",
      BUN_JSC_thresholdForOptimizeSoon: "100",
    };
    const inlineMore = { ...jit, BUN_JSC_maximumFunctionForCallInlineCandidateBytecodeCostForDFG: "1000" };

    test.concurrent.each([
      ["optimized bytecode", true, jit],
      ["optimized bytecode, inlined", true, inlineMore],
      // The recursive case does not need the optimizer.
      ["source, inlined", false, inlineMore],
    ])("%s", async (tag, bytecode, env) => {
      using dir = tempDir("build-optimize-bytecode-catch-liveness", { "index.js": fixture });
      let entry = join(String(dir), "index.js");
      if (bytecode) {
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--bytecode", "--format=cjs", "--target=bun", "index.js", "--outdir", "out"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        expect(buildStderr).not.toContain("error");
        expect(buildExit).toBe(0);
        entry = join(String(dir), "out", "index.js");
        expect(existsSync(entry + ".jsc")).toBe(true);
      }
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok\n");
      expect(exitCode).toBe(0);
    });
  });
});
