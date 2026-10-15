// Differential check of `x = require("<package on the CommonJS unwrap list>")` in an ESM bundle. The bundler turns the
// require() into `import * as ns` and makes `x` that namespace when nothing can rebind `x`; otherwise `x` stays a
// variable. Every cell of the matrix is one such declaration: declaration kind x rebind x read x the scope it is in.
// The program is run unbundled, bundled, and bundled with `minify`, and each cell must log the same values in all
// three runs.
//
// A cell holds exactly one read of its variable: a second use would keep the declaration alive and hide a lost one.
// The matrix is three files of one bundle, so one build per flag set:
//   fn.js    the cells in a function scope
//   eval.js  the cells that rebind through a direct eval
//   top.js   the cells in the module scope, one variable name per cell
import { spawn } from "bun";
import { bunEnv, tempDir } from "harness";

const packages: Record<string, string> = {
  "node_modules/react/package.json": `{ "name": "react", "version": "19.0.0", "main": "index.js" }`,
  // `exports.x = ...`: the file becomes ESM and every export is its own binding.
  "node_modules/react/index.js": `exports.v = "react"; exports.w = "w"; exports.fn = function () { return "fn"; }; exports.a = { b: "ab", c: function () { return "ac:" + this.b; } };`,
  "node_modules/scheduler/package.json": `{ "name": "scheduler", "version": "0.25.0", "main": "index.js" }`,
  // `module.exports = ...`: the file stays a `__commonJS` wrapper.
  "node_modules/scheduler/index.js": `module.exports = { v: "sched", w: "w", fn: function () { return "fn"; }, a: { b: "sab", c: function () { return "sac:" + this.b; } } };`,
};

// `kinds`: the declaration kinds the rebind is valid for (default: var, let).
type Rebind = { code: (x: string, out: string) => string; kinds?: string[]; eval?: boolean };
// `mk(out)` is the value a rebind stores. Its getter `g` logs a read that is a statement, and its `fn` tells
// `x.fn()` from `(0, x.fn)()`.
const rebinds: Record<string, Rebind> = {
  none: { code: () => ``, kinds: ["var", "let", "const"] },
  assign: { code: (x, out) => `${x} = mk(${out});` },
  closure: { code: (x, out) => `(function () { ${x} = mk(${out}); })();` },
  arrayPattern: { code: (x, out) => `[${x}] = [mk(${out})];` },
  objectPattern: { code: (x, out) => `({ a: ${x} } = { a: mk(${out}) });` },
  forOf: { code: (x, out) => `for (${x} of [mk(${out})]) {}` },
  logical: { code: (x, out) => `${x} &&= mk(${out});` },
  // A write that never runs: the variable still holds the namespace.
  neverFn: { code: (x, out) => `function never_${x}() { ${x} = mk(${out}); }` },
  neverArrow: { code: (x, out) => `var never_${x} = () => { ${x} = mk(${out}); };` },
  deadFalse: { code: (x, out) => `if (false) { ${x} = mk(${out}); }` },
  neverBranch: { code: (x, out) => `if (${out}.length > 99) { ${x} = mk(${out}); }` },
  evalWrite: { code: (x, out) => `eval("${x} = mk(${out})");`, eval: true },
  evalRead: { code: (x, out) => `${out}.push(eval("${x}.v"));`, eval: true, kinds: ["var", "let", "const"] },
};

const reads: Record<string, (x: string, out: string) => string> = {
  oneLevel: (x, out) => `${out}.push(${x}.v);`,
  index: (x, out) => `${out}.push(${x}["w"]);`,
  call: (x, out) => `${out}.push(${x}.fn());`,
  twoLevel: (x, out) => `${out}.push(${x}.a.b);`,
  twoLevelCall: (x, out) => `${out}.push(${x}.a.c());`,
  twoLevelIndex: (x, out) => `${out}.push(${x}.a["b"]);`,
  commaCall: (x, out) => `${out}.push((0, ${x}.fn)());`,
  stmt: x => `${x}.g;`,
  itemProp: (x, out) => `${out}.push(${x}.v.length);`,
  template: (x, out) => `${out}.push(\`\${${x}.a.b}\`);`,
  typeofItem: (x, out) => `${out}.push(typeof ${x}.a.b);`,
  typeofValue: (x, out) => `${out}.push(typeof ${x});`,
  optional: (x, out) => `${out}.push(${x}?.v);`,
  inClosure: (x, out) => `${out}.push((function () { return ${x}.v; })());`,
  inArrowTwoLevel: (x, out) => `${out}.push((() => ${x}.a.b)());`,
  destructure: (x, out) => `{ const { v: dv, w: dw = "dflt" } = ${x}; ${out}.push(dv, dw); }`,
};

// "top" is the module scope. The others wrap the cell in a function scope.
const scopes: Record<string, (body: string) => string> = {
  fn: body => `(function () { ${body} })();`,
  arrow: body => `(() => { ${body} })();`,
  method: body => `({ m() { ${body} } }).m();`,
  staticBlock: body => `(class { static { ${body} } });`,
  nestedFn: body => `(function outer() { var unrelated = 1; (function inner() { ${body} })(); return unrelated; })();`,
  fnBlock: body => `(function () { if (out) { ${body} } })();`,
};

export type Options = {
  packages?: string[];
  kinds?: string[];
  rebinds?: string[];
  reads?: string[];
  scopes?: string[];
};

const prelude =
  `"use strict";\n` +
  `const cells = (globalThis.__cells ??= {});\n` +
  `const mk = out => ({ v: "N", w: "Nw", fn() { return this === undefined ? "N-nothis" : "N-this:" + this.v; }, a: { b: "Nab", c() { return "Nac:" + this.b; } }, get g() { out.push("Ngetter"); return 1; } });\n`;

export function generate(options: Options = {}): { files: Record<string, string>; names: string[] } {
  const kinds = options.kinds ?? ["var", "let", "const"];
  let [fnSource, evalSource, topSource] = [prelude, prelude, prelude];
  const names: string[] = [];
  for (const pkg of options.packages ?? ["react", "scheduler"]) {
    for (const kind of kinds) {
      for (const rebindName of options.rebinds ?? Object.keys(rebinds)) {
        const rebind = rebinds[rebindName];
        if (!(rebind.kinds ?? ["var", "let"]).includes(kind)) continue;
        for (const readName of options.reads ?? Object.keys(reads)) {
          for (const scope of options.scopes ?? ["top", ...Object.keys(scopes)]) {
            const name = `${pkg}_${kind}_${rebindName}_${readName}_${scope}`;
            if (scope === "top") {
              // A direct eval at the top level makes the whole file a `__commonJS` wrapper.
              if (rebind.eval) continue;
              const [x, out] = [`x${names.length}`, `o${names.length}`];
              names.push(name);
              topSource +=
                `const ${out} = (cells[${JSON.stringify(name)}] = []);\n` +
                `${kind} ${x} = require("${pkg}");\n` +
                `${rebind.code(x, out)}\n` +
                `try { ${reads[readName](x, out)} } catch (e) { ${out}.push("threw " + e.name); }\n`;
              continue;
            }
            names.push(name);
            const body = `${kind} x = require("${pkg}"); ${rebind.code("x", "out")} ${reads[readName]("x", "out")}`;
            const cell = `{ const out = (cells[${JSON.stringify(name)}] = []); try { ${scopes[scope](body)} } catch (e) { out.push("threw " + e.name); } }\n`;
            if (rebind.eval) evalSource += cell;
            else fnSource += cell;
          }
        }
      }
    }
  }
  return {
    names,
    files: {
      ...packages,
      "fn.js": fnSource,
      "eval.js": evalSource,
      "top.js": topSource,
      "entry.mjs": `import "./fn.js";\nimport "./eval.js";\nimport "./top.js";\n`,
      // One process runs the program unbundled, then builds and runs each bundle.
      "run.mjs": `
        const runs = {};
        const run = async (name, file) => {
          globalThis.__cells = undefined;
          try {
            await import(file);
            runs[name] = globalThis.__cells;
          } catch (e) {
            runs[name] = String(e);
          }
        };
        await run("unbundled", import.meta.dir + "/entry.mjs");
        for (const minify of [false, true]) {
          const name = minify ? "minified" : "plain";
          const result = await Bun.build({
            entrypoints: [import.meta.dir + "/entry.mjs"],
            outdir: import.meta.dir + "/" + name,
            minify,
            throw: false,
          });
          if (result.success) await run(name, import.meta.dir + "/" + name + "/entry.js");
          else runs[name] = result.logs.join("\\n");
        }
        console.log(JSON.stringify(runs));
      `,
    },
  };
}

type Wrong = Record<string, { unbundled: unknown; bundled: unknown }>;

/** The cells whose bundled run logs other values than the unbundled run, for the plain and the minified bundle. */
export async function checkMatrix(bun: string, options: Options = {}) {
  const matrix = generate(options);
  using dir = tempDir("unwrapped-require-matrix", matrix.files);
  await using proc = spawn({ cmd: [bun, "run.mjs"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error("the run failed: " + stderr.slice(0, 400));
  const runs = JSON.parse(stdout);
  if (typeof runs.unbundled !== "object") throw new Error("the unbundled run failed: " + runs.unbundled);

  const wrong = (bundled: unknown): Wrong => {
    if (typeof bundled !== "object" || bundled === null) return { all: { unbundled: "ran", bundled } };
    return Object.fromEntries(
      matrix.names
        .filter(name => !Bun.deepEquals(bundled[name], runs.unbundled[name]))
        .map(name => [name, { unbundled: runs.unbundled[name], bundled: bundled[name] }]),
    );
  };
  return { cells: matrix.names.length, plain: wrong(runs.plain), minified: wrong(runs.minified) };
}
