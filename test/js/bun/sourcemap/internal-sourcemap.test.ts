import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join, sep } from "node:path";

// Runtime-transpiled modules store an InternalSourceMap blob (varint stream +
// sync points) instead of expanding VLQ into a Mapping.List. These tests pin
// the remapped line:col for a few stack-trace shapes so the sync-index lookup
// can't drift without notice.
const fixture = `\
type Unused = { a: number };

function alpha(): never {
  const x: Unused = { a: 1 };
  void x;
  throw new Error("boom");
}

function beta() {
  return alpha();
}

function gamma() {
  return beta();
}

function captureViaCaptureStackTrace() {
  const obj: { stack?: string } = {};
  Error.captureStackTrace(obj, captureViaCaptureStackTrace);
  return obj.stack!;
}

try {
  gamma();
} catch (e) {
  console.log("--throw--");
  console.log((e as Error).stack);
}

console.log("--newError--");
console.log(new Error("here").stack);

console.log("--captureStackTrace--");
console.log(captureViaCaptureStackTrace());
`;

// Keep only the line:col suffixes from frames inside our fixture so the
// comparison is independent of temp-dir paths and frame formatting.
function extractPositions(stack: string): string[] {
  return stack
    .split("\n")
    .map(line => {
      const m = line.match(/index\.ts:(\d+):(\d+)/);
      return m ? `${m[1]}:${m[2]}` : null;
    })
    .filter((s): s is string => s !== null);
}

async function run(files: Record<string, string>, env: Record<string, string> = {}) {
  using dir = tempDir("internal-sourcemap", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exited };
}

describe("InternalSourceMap", () => {
  test("remaps thrown error, new Error().stack, and captureStackTrace to original lines", async () => {
    const { stdout, stderr, exited } = await run({ "index.ts": fixture });

    expect(stderr).toBe("");

    const positions = extractPositions(stdout);
    expect(positions).toEqual([
      "6:13", // throw new Error("boom")
      "24:3", // gamma() at top level
      "31:17", // new Error("here").stack
      "34:13", // captureViaCaptureStackTrace()
    ]);

    expect(exited).toBe(0);
  });

  // Source-map columns count UTF-16 code units. A non-ASCII character earlier
  // on the line (Latin-1, astral, CJK) must not shift the remapped columns of
  // the tokens that follow it.
  test("columns after a non-ASCII character on the same line remap exactly", async () => {
    const lines = [
      `const za = "e"; function a1() { return new Error("A").stack!; }`,
      `const zb = "é"; function b1() { return new Error("B").stack!; }`,
      `const zc = "🎉"; function c1() { return new Error("C").stack!; }`,
      `const zd = "汉字 héllo wörld"; function d1() { return new Error("D").stack!; }`,
      `console.log(a1());`,
      `console.log(b1());`,
      `console.log(c1());`,
      `console.log(d1());`,
    ];

    const { stdout, stderr, exited } = await run({ "index.ts": lines.join("\n") + "\n" });

    expect(stderr).toBe("");
    // Each frame must point at its line's `Error` in 1-based UTF-16 columns,
    // `a1` being the all-ASCII control.
    const frames = [...stdout.matchAll(/at ([a-d]1) \(.*index\.ts:(\d+):(\d+)\)/g)].map(m => `${m[1]} ${m[2]}:${m[3]}`);
    expect(frames).toEqual(["a1", "b1", "c1", "d1"].map((fn, i) => `${fn} ${i + 1}:${lines[i].indexOf("Error(") + 1}`));
    expect(exited).toBe(0);
  });

  // `toMatchInlineSnapshot` resolves its call site from the remapped stack
  // position, which counts UTF-16 code units. An astral character earlier on
  // the line made the updater land past the callee and fail with
  // "Could not find 'toMatchInlineSnapshot' here".
  test("inline snapshot call sites resolve after astral characters on the same line", async () => {
    const fixture = [
      `import { test, expect } from "bun:test";`,
      `test("astral", () => {`,
      `  expect("𐀁").toMatchInlineSnapshot();`,
      `  expect("𐀁𐀂").toMatchInlineSnapshot();`,
      `});`,
      ``,
    ].join("\n");
    using dir = tempDir("inline-snapshot-astral", { "astral.test.ts": fixture });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "-u", "astral.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Failed to update inline snapshot");
    expect(await Bun.file(join(String(dir), "astral.test.ts")).text()).toBe(
      [
        `import { test, expect } from "bun:test";`,
        `test("astral", () => {`,
        '  expect("𐀁").toMatchInlineSnapshot(`"𐀁"`);',
        '  expect("𐀁𐀂").toMatchInlineSnapshot(`"𐀁𐀂"`);',
        `});`,
        ``,
      ].join("\n"),
    );
    expect(exited).toBe(0);
  });

  // Minified-shape: a single ~12KB line with thousands of mappings forces the
  // bit-packed `gc_w` lane wide and the absolute SyncEntry.gen_col into the
  // thousands, while `gl_mask` is all-zeros. Stack column must still remap to
  // the original `throw`.
  test("remaps a throw deep into a single very long line", async () => {
    let src = "";
    for (let i = 0; i < 1000; i++) src += `const a${i}:number=${i};`;
    // One very long identifier forces a single ~10k-column delta inside one
    // window so the bit-packed `gc` lane width must exceed 8 bits.
    src += `const ${Buffer.alloc(10000, "Z").toString()}: number = 0;`;
    const throwCol = src.length + 1;
    src += `throw new Error("x");\n`;

    const { stderr, exited } = await run({ "index.ts": src });

    const m = stderr.match(/index\.ts:1:(\d+)/);
    expect(m).not.toBeNull();
    // Mapped column lands inside the `throw new Error(...)` expression. The
    // printer maps the throw at the `Error` constructor, ~10 columns past the
    // `throw` keyword; a tolerance well under one statement width still rejects
    // sync-index or bit-lane drift (which would be off by hundreds/thousands).
    expect(Math.abs(Number(m![1]) - throwCol)).toBeLessThan(24);
    expect(exited).toBe(1);
  });

  // 200 single-expression lines so the map has well over `sync_interval` (64)
  // mappings and lookup must bsearch past sync_points[0].
  test("remaps frames past multiple sync points", async () => {
    const lines: string[] = ["let v: number = 0;"];
    for (let i = 0; i < 200; i++) lines.push(`v = (v + ${i}) | 0;`);
    lines.push("function deep() { return new Error('e').stack!; }");
    lines.push("console.log(deep());");
    const big = lines.join("\n") + "\n";

    const { stdout, stderr, exited } = await run({ "index.ts": big });

    expect(stderr).toBe("");
    // `function deep()` is at source line 202; the call is at line 203.
    expect(stdout).toMatch(/index\.ts:202:\d+/);
    expect(stdout).toMatch(/index\.ts:203:\d+/);
    expect(exited).toBe(0);
  });

  test("FindCache eviction (>16 distinct windows in one stack)", async () => {
    // 20 functions spread ~125 lines apart in a single file. With ~6 mappings
    // per padding line that's ~750 mappings between calls -> each frame lands
    // in a different K=64 window, and 20 windows > FindCache.slot_count (16),
    // so the cache must evict mid-stack. Capture twice so the second pass
    // exercises lookups against post-eviction slot state.
    const lines: string[] = ["Error.stackTraceLimit = 50;", "export const keep: number[] = [];"];
    const callLines: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (let p = 0; p < 125; p++) lines.push(`keep.push(${i * 1000 + p});`);
      callLines.push(lines.length + 1);
      lines.push(
        i === 0
          ? `function f0(): string { return new Error("e").stack!; }`
          : `function f${i}(): string { return f${i - 1}(); }`,
      );
    }
    lines.push(`const stacks: string[] = [];`);
    lines.push(`for (let i = 0; i < 2; i++) stacks.push(f19());`);
    lines.push(
      `if (stacks[0] !== stacks[1]) throw new Error("FindCache produced different positions across passes:\\n" + stacks[0] + "\\n---\\n" + stacks[1]);`,
    );
    lines.push(`console.log(stacks[0]);`);

    // Disable JSC tail-call elimination so all 20 frames survive in the stack.
    const { stdout, stderr, exited } = await run(
      { "index.ts": lines.join("\n") + "\n" },
      { BUN_JSC_useTailCalls: "0" },
    );

    expect(stderr).toBe("");
    for (const ln of callLines) {
      expect(stdout).toMatch(new RegExp(`index\\.ts:${ln}:`));
    }
    expect(exited).toBe(0);
  });
});

// A source map describes one text: what the transpiler printed for one load of a file. The name of the file does not
// say which text a frame ran. A file is loaded again after it changed, with another query or as another type, and
// `eval` code names any file it likes.
describe.concurrent("a source map maps the text it was made with", () => {
  async function runJSON(files: Record<string, string>, entry: string) {
    using dir = tempDir("internal-sourcemap-texts", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }

  test("code of an earlier load of a file keeps its positions after the file is loaded again", async () => {
    const out = await runJSON(
      {
        "main.mjs": String.raw`
          import { writeFileSync } from "node:fs";
          import { createRequire } from "node:module";
          import path from "node:path";
          const require = createRequire(import.meta.url);
          const dir = import.meta.dirname;
          const at = e => e.stack.split("\n")[1].trim().replaceAll(dir + path.sep, "");
          // make() is on the line below "lines" lines of types, which the transpiler removes.
          const text = (lines, message) =>
            Array.from({ length: lines }, (_, i) => "type T" + i + " = number;\n").join("") +
            "export function make(): Error { try { throw new Error('" + message + "'); } catch (e) { return e as Error; } }\n";
          const commonjs = source => source.replace("export function make", "exports.make = function make");
          const out = {};

          // A CommonJS file that changes between two require() calls.
          const cjs = path.join(dir, "changes.cts");
          writeFileSync(cjs, commonjs(text(2, "first")));
          const first = require(cjs);
          writeFileSync(cjs, commonjs(text(5, "second")));
          delete require.cache[cjs];
          const second = require(cjs);
          out.require = { first: at(first.make()), second: at(second.make()) };
          // The file holds another text now: the code frame of the first load is not cut from it.
          out.preview = Bun.inspect(first.make());

          // An ES module that changes between two import() calls with different queries.
          const esm = path.join(dir, "changes.ts");
          writeFileSync(esm, text(2, "first"));
          const one = await import(esm + "?v=1");
          writeFileSync(esm, text(5, "second"));
          const two = await import(esm + "?v=2");
          out.import = { first: at(one.make()), second: at(two.make()) };

          // A module, and its file imported as text.
          const both = path.join(dir, "both.ts");
          writeFileSync(both, text(3, "module"));
          const module = await import(both);
          const before = at(module.make());
          await import(both, { with: { type: "text" } });
          out.text = { before, after: at(module.make()) };

          console.log(JSON.stringify(out));
        `,
      },
      "main.mjs",
    );
    const { preview, ...positions } = out;
    expect(positions).toEqual({
      require: { first: "at make (changes.cts:3:57)", second: "at make (changes.cts:6:57)" },
      import: { first: "at make (changes.ts:3:49)", second: "at make (changes.ts:6:49)" },
      text: { before: "at make (both.ts:4:49)", after: "at make (both.ts:4:49)" },
    });
    expect(preview).toContain('Error("first")');
    expect(preview).not.toContain("second");
    expect(preview).not.toContain("type T");
  });

  // A save that adds a comment or a type leaves the text that the transpiler prints as it was, and the source map of
  // that text is another one. JavaScriptCore runs a module that is loaded again on the code of the load before it when
  // the text is the same, so the loads of one text of a file have one source map: the one that was made last.
  test("loads of a file whose text is the same are mapped through the map that was made last", async () => {
    const out = await runJSON(
      {
        "main.mjs": String.raw`
          import { writeFileSync } from "node:fs";
          import { createRequire } from "node:module";
          import path from "node:path";
          const require = createRequire(import.meta.url);
          const dir = import.meta.dirname;
          const at = e => e.stack.split("\n")[1].trim().replaceAll(dir + path.sep, "");
          // make() is on the line below "lines" comments, which the transpiler removes.
          const text = (lines, message = "x") =>
            "// a comment\n".repeat(lines) +
            "export function make(): Error { try { throw new Error('" + message + "'); } catch (e) { return e as Error; } }\n";
          const commonjs = source => source.replace("export function make", "exports.make = function make");
          const out = {};
          // Loads "file" when make() is on line 3 and again when it is on line 6.
          const twice = async (file, load, source = text) => {
            writeFileSync(file, source(2));
            const first = await load(file, 1);
            writeFileSync(file, source(5));
            const second = await load(file, 2);
            return [first, second];
          };
          const positions = loads => loads.map(({ make }) => at(make()));

          // An ES module under one key.
          const sameKey = await twice(path.join(dir, "same-key.ts"), file => {
            delete require.cache[file];
            return import(file);
          });
          out.sameKey = { loads: new Set(sameKey).size, at: positions(sameKey) };

          // An ES module under two keys.
          out.query = positions(await twice(path.join(dir, "query.ts"), (file, i) => import(file + "?v=" + i)));

          // A CommonJS module.
          const required = await twice(
            path.join(dir, "required.cts"),
            file => {
              delete require.cache[file];
              return require(file);
            },
            lines => commonjs(text(lines)),
          );
          out.require = positions(required);

          // A module of two module graphs, both of which are there.
          out.graphs = {
            module: positions(await twice(path.join(dir, "graph.ts"), file => new Bun.ModuleGraph().import(file))),
            commonjs: positions(
              await twice(
                path.join(dir, "graph.cts"),
                file => new Bun.ModuleGraph().import(file),
                lines => commonjs(text(lines)),
              ),
            ),
          };

          // Two files with the same text.
          writeFileSync(path.join(dir, "one.ts"), text(2));
          writeFileSync(path.join(dir, "other.ts"), text(5));
          out.files = positions([await import("./one.ts"), await import("./other.ts")]);

          // Another text of the file does not change what is known of this one.
          writeFileSync(path.join(dir, "required.cts"), commonjs(text(0, "another text")));
          delete require.cache[path.join(dir, "required.cts")];
          out.afterAnotherText = positions([require("./required.cts"), ...required]);

          console.log(JSON.stringify(out));
        `,
      },
      "main.mjs",
    );
    expect(out).toEqual({
      sameKey: { loads: 2, at: ["at make (same-key.ts:6:49)", "at make (same-key.ts:6:49)"] },
      query: ["at make (query.ts:6:49)", "at make (query.ts:6:49)"],
      require: ["at make (required.cts:6:57)", "at make (required.cts:6:57)"],
      graphs: {
        module: ["at make (graph.ts:6:49)", "at make (graph.ts:6:49)"],
        commonjs: ["at make (graph.cts:6:57)", "at make (graph.cts:6:57)"],
      },
      files: ["at make (one.ts:3:49)", "at make (other.ts:6:49)"],
      afterAnotherText: ["at make (required.cts:1:57)", "at make (required.cts:6:57)", "at make (required.cts:6:57)"],
    });
  });

  // JavaScriptCore runs a load on the code of an earlier load of the same text, whatever was loaded under the name of
  // the file in between: a save that does not parse, another text under another key of the module, a module graph
  // with other globals.
  test("a text that is loaded again after another text of its file is mapped through the map that was made last", async () => {
    const out = await runJSON(
      {
        "main.mjs": String.raw`
          import { mkdirSync, writeFileSync } from "node:fs";
          import { createRequire } from "node:module";
          import path from "node:path";
          const require = createRequire(import.meta.url);
          const dir = import.meta.dirname;
          const at = e => e.stack.split("\n")[1].trim().replace(/\(.*[\\/]/, "(");
          // make() is on the line below "lines" comments, which the transpiler removes.
          const text = (lines, message = "x") =>
            "// a comment\n".repeat(lines) +
            "export function make(): Error { try { throw new Error('" + message + "'); } catch (e) { return e as Error; } }\n";
          const commonjs = source => source.replace("export function make", "exports.make = function make");
          const again = file => {
            delete require.cache[file];
            return import(file);
          };
          const out = {};

          // A save that only JavaScriptCore's parser rejects, then the first text under more comments.
          const failed = path.join(dir, "failed.ts");
          writeFileSync(failed, text(2));
          const beforeTheFailure = await import(failed);
          writeFileSync(failed, "export const r = /(/;\n" + text(2));
          const failure = await again(failed).then(
            () => "loaded",
            e => e.name,
          );
          writeFileSync(failed, text(5));
          const afterTheFailure = await again(failed);
          out.failed = { failure, at: [at(beforeTheFailure.make()), at(afterTheFailure.make())] };

          // Another text under another key of the module.
          const keys = path.join(dir, "keys.ts");
          writeFileSync(keys, text(2));
          const first = await import(keys);
          writeFileSync(keys, text(0, "another text"));
          const other = await import(keys + "?other");
          writeFileSync(keys, text(5));
          const second = await again(keys);
          out.keys = [at(first.make()), at(other.make()), at(second.make())];

          // Module graphs: the third runs the code of the first, and the second has other globals.
          const graphs = async (file, source) => {
            writeFileSync(file, source(text(2)));
            const a = await new Bun.ModuleGraph({ globals: { tenant: "a" } }).import(file);
            writeFileSync(file, source(text(0, "another text")));
            const b = await new Bun.ModuleGraph({ globals: { other: "b" } }).import(file);
            writeFileSync(file, source(text(5)));
            const c = await new Bun.ModuleGraph({ globals: { tenant: "c" } }).import(file);
            return [a, b, c].map(({ make }) => at(make()));
          };
          out.graphs = {
            module: await graphs(path.join(dir, "graphs.ts"), source => source),
            commonjs: await graphs(path.join(dir, "graphs.cts"), commonjs),
          };

          // One name of a file is an 8-bit string in one load and a 16-bit string in the next.
          const latin1 = path.join(dir, "caf\u00e9");
          mkdirSync(latin1);
          const lib = path.join(latin1, "lib.cts");
          writeFileSync(path.join(latin1, "main.cjs"), "module.exports = require('./lib.cts');\n");
          writeFileSync(lib, commonjs(text(2)));
          const narrow = JSON.parse(JSON.stringify({ lib })).lib;
          const entry = await new Bun.ModuleGraph().import(narrow);
          writeFileSync(lib, commonjs(text(5)));
          const required = await new Bun.ModuleGraph().import(path.join(latin1, "main.cjs"));
          out.latin1 = [entry, required].map(module => at((module.make ?? module.default.make)()));

          console.log(JSON.stringify(out));
        `,
      },
      "main.mjs",
    );
    expect(out).toEqual({
      failed: { failure: "SyntaxError", at: ["at make (failed.ts:6:49)", "at make (failed.ts:6:49)"] },
      keys: ["at make (keys.ts:6:49)", "at make (keys.ts:1:49)", "at make (keys.ts:6:49)"],
      graphs: {
        module: ["at make (graphs.ts:6:49)", "at make (graphs.ts:1:49)", "at make (graphs.ts:6:49)"],
        commonjs: ["at make (graphs.cts:6:57)", "at make (graphs.cts:1:57)", "at make (graphs.cts:6:57)"],
      },
      latin1: ["at make (lib.cts:6:57)", "at make (lib.cts:6:57)"],
    });
  });

  test("eval code that names a loaded file in its sourceURL keeps its own positions", async () => {
    // The transpiler removes the comment, so every line that the source map of the fixture itself can answer with
    // is below it. Each function is on line 5 of its code.
    const padding = ["/*", ...Array.from({ length: 18 }, () => " *"), " */"].join("\n") + "\n";
    const out = await runJSON(
      {
        "fixture.js":
          padding +
          String.raw`
            const path = require("node:path");
            const names = { own: __filename, other: path.join(__dirname, "not-a-file.js") };
            const compile = {
              eval: name => (0, eval)("\n\n\n\n(function f() { return new Error('boom'); })\n//# sourceURL=" + name),
              Function: name => new Function("\n\n\nreturn new Error('boom')\n//# sourceURL=" + name),
            };
            // "own" and "other" have to say the same thing about different names.
            const unnamed = text =>
              text.replaceAll(__dirname + path.sep, "").replaceAll(/not-a-file\.js|fixture\.js/g, "NAME");
            const out = {};
            for (const [api, make] of Object.entries(compile)) {
              out[api] = {};
              for (const [kind, name] of Object.entries(names)) {
                const f = make(name);
                const e = f();
                out[api][kind] = {
                  at: unnamed(e.stack.split("\n")[1].trim()),
                  line: e.line,
                  column: e.column,
                  // Of an error whose stack was not read: the printer takes the frames from the engine.
                  inspect: unnamed(Bun.inspect(f())).split("\n"),
                };
              }
            }
            console.log(JSON.stringify(out));
          `,
      },
      "fixture.js",
    );
    expect(out.eval.other).toMatchObject({ at: "at f (NAME:5:33)", line: 5 });
    expect(out.eval.other.inspect).toContain("5 | (function f() { return new Error('boom'); })");
    expect({ eval: out.eval.own, Function: out.Function.own }).toEqual({
      eval: out.eval.other,
      Function: out.Function.other,
    });
  });

  // A graph compiles a CommonJS module under a source provider that wraps the one of the transpiled text, and a
  // second graph of the same shape calls the wrapper that the first one compiled.
  test("a CommonJS module of a Bun.ModuleGraph is mapped back to its file", async () => {
    const out = await runJSON(
      {
        "lib.cts": [
          "type A = number;",
          "type B = number;",
          "type C = number;",
          'exports.make = function make(): Error { try { throw new Error("x"); } catch (e) { return e as Error; } };',
          "",
        ].join("\n"),
        "main.mjs": String.raw`
          import path from "node:path";
          const lib = path.join(import.meta.dirname, "lib.cts");
          const at = e => e.stack.split("\n")[1].trim().replaceAll(import.meta.dirname + path.sep, "");
          const out = [];
          for (let i = 0; i < 2; i++) {
            const { make } = await new Bun.ModuleGraph().import(lib);
            out.push(at(make()), Bun.inspect(make()).includes('4 | exports.make = function make(): Error'));
          }
          console.log(JSON.stringify(out));
        `,
      },
      "main.mjs",
    );
    expect(out).toEqual(["at make (lib.cts:4:57)", true, "at make (lib.cts:4:57)", true]);
  });

  // A file that starts with "// @bun" is not transpiled again: the provider of its text reads the source map that
  // the text links to when a position in it is first asked for.
  test("a file that Bun bundled is mapped through the source map it links to", async () => {
    const out = await runJSON(
      {
        "main.mjs": String.raw`
          import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
          import { createRequire } from "node:module";
          import path from "node:path";
          const require = createRequire(import.meta.url);
          const dir = import.meta.dirname;
          const at = e => e.stack.split("\n")[1].trim().replaceAll(dir + path.sep, "");
          // make() is on the line below "lines" comments, which the bundler removes.
          const build = async (name, lines, sourcemap = "external", message = "x") => {
            writeFileSync(
              path.join(dir, name + ".ts"),
              "// a comment\n".repeat(lines) +
                "export function make(): Error { try { throw new Error('" + message + "'); } catch (e) { return e as Error; } }\n",
            );
            const result = await Bun.build({
              entrypoints: [path.join(dir, name + ".ts")],
              outdir: path.join(dir, "out"),
              target: "bun",
              format: "cjs",
              sourcemap,
            });
            if (!result.success) throw new AggregateError(result.logs);
            return path.join(dir, "out", name + ".js");
          };
          const out = {};

          // The file is built again from a source with more comments: the same text, and another map beside it.
          const twice = await build("twice", 2);
          const text = readFileSync(twice, "utf8");
          const first = require(twice);
          out.first = at(first.make());
          await build("twice", 5);
          out.sameText = readFileSync(twice, "utf8") === text;
          delete require.cache[twice];
          const second = require(twice);
          out.second = [at(first.make()), at(second.make())];

          // A sourceURL comment names the code, and does not say where its source map is.
          const renamed = await build("renamed", 2);
          appendFileSync(renamed, "\n//# sourceURL=another-name.js\n");
          out.renamed = at(require(renamed).make());

          // The file is built again with another text, and the map of each text is in the text. The map of the
          // earlier load is read before the second build ("asked"), or only after it ("late").
          for (const name of ["asked", "late"]) {
            const file = await build(name, 2, "inline", "first");
            const earlier = require(file);
            const before = name === "asked" ? at(earlier.make()) : undefined;
            await build(name, 5, "inline", "second");
            delete require.cache[file];
            const later = require(file);
            out[name] = { before, earlier: at(earlier.make()), later: at(later.make()) };
          }

          // The file is built with another text and then with the first one again. The map of each is a file
          // beside it, and a position in the first load is asked for while the other map is there.
          const undone = await build("undone", 2, "external", "first");
          const firstBuild = require(undone);
          await build("undone", 5, "external", "second");
          delete require.cache[undone];
          require(undone);
          at(firstBuild.make());
          await build("undone", 2, "external", "first");
          delete require.cache[undone];
          const lastBuild = require(undone);
          out.undone = [at(firstBuild.make()), at(lastBuild.make())];

          console.log(JSON.stringify(out));
        `,
      },
      "main.mjs",
    );
    expect(out).toEqual({
      first: "at make (twice.ts:3:49)",
      sameText: true,
      second: ["at make (twice.ts:6:49)", "at make (twice.ts:6:49)"],
      renamed: "at make (renamed.ts:3:49)",
      asked: {
        before: "at make (asked.ts:3:49)",
        earlier: "at make (asked.ts:3:49)",
        later: "at make (asked.ts:6:49)",
      },
      late: { earlier: "at make (late.ts:3:49)", later: "at make (late.ts:6:49)" },
      undone: ["at make (undone.ts:3:49)", "at make (undone.ts:3:49)"],
    });
  });

  // The second and the third file take what was transpiled of helper.ts from the source cache, so nothing makes its
  // source map again. Text that the second file compiles under the name of helper.ts is not that text.
  test.each(["--isolate", "--isolate=modules"])(
    "bun test %s: a module from the source cache is still mapped back to its file",
    async isolate => {
      const importsHelper = `
        import { test, expect } from "bun:test";
        import { make } from "./helper.ts";
        test("make", () => { expect(make().stack.split("\\n")[1]).toEndWith("helper.ts:4:49)"); });
      `;
      using dir = tempDir("internal-sourcemap-isolate", {
        "helper.ts": [
          "type A = number;",
          "type B = number;",
          "type C = number;",
          'export function make(): Error { try { throw new Error("x"); } catch (e) { return e as Error; } }',
          "",
        ].join("\n"),
        "a.test.ts": importsHelper,
        "b.test.ts": `
          import { test, expect } from "bun:test";
          import Module from "node:module";
          import { make } from "./helper.ts";
          test("make", () => {
            const file = require.resolve("./helper.ts");
            const compiled = new Module(file);
            compiled._compile("\\n\\n\\n\\n\\n\\nexports.make = function make() { try { throw new Error('y'); } catch (e) { return e; } };", file);
            expect(compiled.exports.make().stack.split("\\n")[1]).toContain("helper.ts:7:");
            expect(make().stack.split("\\n")[1]).toEndWith("helper.ts:4:49)");
          });
        `,
        "c.test.ts": importsHelper,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", isolate, "./a.test.ts", "./b.test.ts", "./c.test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(" 3 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    },
  );

  // Printing an error reads its frames, then its message, then maps the frames. A message getter can be the last
  // thing that holds the code of a frame, and what it loads can take the place of that code in memory.
  test("a frame whose code is collected while its error is printed keeps its position", async () => {
    const late = (i: number) =>
      Array.from({ length: 43 }, (_, line) => "type T" + line + " = number;\n").join("") +
      "exports.late = function late() { return " +
      i +
      "; };\n";
    using dir = tempDir("internal-sourcemap-collected-frame", {
      "mod.ts": [
        "type A = { a: number };",
        "type B = { b: string };",
        "interface C { c: boolean }",
        "exports.make = function make(cb) { return cb(); };",
        "",
      ].join("\n"),
      ...Object.fromEntries(Array.from({ length: 64 }, (_, i) => ["late/l" + i + ".ts", late(i)])),
      "main.js": String.raw`
        const path = require("node:path");
        const file = require.resolve("./mod.ts");
        let make = require(file).make;
        delete require.cache[file];
        module.children.length = 0;
        // JavaScriptCore lets go of the code it keeps for a text that it may be given again.
        Bun.shrink();
        setImmediate(() => {
          Bun.gc(true);
          // The frames of the error hold make() weakly.
          const error = make(() => new Error("original"));
          Object.defineProperty(error, "message", {
            get() {
              make = null;
              Bun.gc(true);
              for (let i = 0; i < 64; i++) require(path.join(__dirname, "late", "l" + i + ".ts"));
              return "read late";
            },
          });
          console.error(error);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr.replaceAll(String(dir) + sep, "")).toContain("at make (mod.ts:4:43)");
    expect(exitCode).toBe(0);
  });

  // A source map is kept for the code that can still run, and goes with it.
  test("the source map of a module is dropped when the module is collected", async () => {
    const out = await runJSON(
      {
        "main.cjs": String.raw`
          const { savedSourceMapCount } = require("bun:internal-for-testing");
          const fs = require("node:fs");
          const path = require("node:path");
          const files = Array.from({ length: 40 }, (_, i) => path.join(__dirname, "module" + i + ".cts"));
          for (const [i, file] of files.entries()) fs.writeFileSync(file, "type T = number;\nexports.i = " + i + ";\n");

          const before = savedSourceMapCount();
          for (const file of files) require(file);
          const loaded = savedSourceMapCount() - before;
          for (const file of files) delete require.cache[file];
          module.children.length = 0;
          // JavaScriptCore keeps the code of a text that it may be given again, and with it the provider of the text.
          Bun.shrink();
          setImmediate(() => {
            for (let i = 0; i < 10 && savedSourceMapCount() > before; i++) Bun.gc(true);
            const left = savedSourceMapCount() - before;
            console.log(JSON.stringify({ loaded, mostAreGone: left < files.length / 4 }));
          });
        `,
      },
      "main.cjs",
    );
    expect(out).toEqual({ loaded: 40, mostAreGone: true });
  });

  // toMatchInlineSnapshot() looks in the test file for its call at the position that the stack gives. For a call in
  // vm code that is a position in the vm code, whatever file the code is named after.
  test("an inline snapshot call in vm code is looked for at its position in that code", async () => {
    // The transpiler removes the comment, so every line that the source map of the test file can answer with is
    // below it. The calls are on line 5 and on line 7 of their vm code.
    const padding = ["/*", ...Array.from({ length: 18 }, () => " *"), " */"].join("\n") + "\n";
    const fixture =
      padding +
      String.raw`
        import { test, expect } from "bun:test";
        import vm from "node:vm";
        const source = "\n\n\n\n(function check(expect) { expect(1).toMatchInlineSnapshot(); })";
        test("from vm code", () => {
          vm.runInThisContext(source, { filename: import.meta.path })(expect);
        });
        const deferred =
          "\n\n\n\n\n\n(async function check(expect) { await expect(Promise.resolve(1)).resolves.toMatchInlineSnapshot(); })";
        test("from vm code, of a promise", async () => {
          await vm.runInThisContext(deferred, { filename: import.meta.path })(expect);
        });
      `;
    using dir = tempDir("inline-snapshot-vm", { "vm.test.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "-u", "vm.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Failed to update inline snapshot: Ln 5, Col 58 not found");
    expect(stderr).toContain("Failed to update inline snapshot: Ln 7, Col 96 not found");
    expect(await Bun.file(join(String(dir), "vm.test.ts")).text()).toBe(fixture);
  });

  // Bun's parser accepts a regular expression that JavaScriptCore rejects. The error has the source URL and the line
  // of the transpiled text, and no frame in it.
  test("a SyntaxError that only JavaScriptCore reports is at its line of the file", async () => {
    const bad = ["type A = {", "  a: number;", "};", "type B = {", "  b: number;", "};", '"".test(/[a-0]/);', ""];
    const out = await runJSON(
      {
        // No import, export, module or exports: JavaScriptCore's module loader parses both.
        "plain.ts": bad.join("\n"),
        "module.ts": bad.join("\n") + "export {};\n",
        "main.cjs": String.raw`
          const path = require("node:path");
          const out = {};
          for (const file of ["plain.ts", "module.ts"]) {
            try {
              require("./" + file);
            } catch (e) {
              const parse = String(e.stack).split("\n").find(line => line.includes("<parse>")) ?? "";
              out[file] = { name: e.name, line: e.line, parse: parse.trim().replaceAll(__dirname + path.sep, "") };
            }
          }
          console.log(JSON.stringify(out));
        `,
      },
      "main.cjs",
    );
    expect(out).toEqual({
      "plain.ts": { name: "SyntaxError", line: 7, parse: "at <parse> (plain.ts:7)" },
      "module.ts": { name: "SyntaxError", line: 7, parse: "at <parse> (module.ts:7)" },
    });
  });
});
