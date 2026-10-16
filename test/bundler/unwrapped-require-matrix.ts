// Differential check of `x = require("<package on the CommonJS unwrap list>")` in an ESM bundle. The bundler turns the
// require() into `import * as ns` and makes `x` that namespace when nothing can rebind `x`; otherwise `x` stays a
// variable. Every cell of the matrix is one such declaration: declaration kind x rebind x read x the scope it is in x
// the order in which the bundler visits the read and the rebind. The program is run unbundled, bundled, and bundled
// with `minify`, and each cell must log the same values in all three runs, except the cells of `knownGap`.
//
// A cell holds exactly one read of its variable: a second use would keep the declaration alive and hide a lost one.
// The cells are in bundles of `cellsPerBundle`, because the run time of one program grows faster than its size. A
// bundle is three files:
//   fn.js    the cells in a function scope
//   eval.js  the cells that rebind through a direct eval
//   top.js   the cells at the top level of the module, one variable name per cell
//
// Run this file to print the cells that are wrong: `bun unwrapped-require-matrix.ts [path to bun] [options as JSON]`.
import { spawn } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";

// `fn` tells `x.fn()` from `(0, x.fn)()`.
const fn = `function () { return this === undefined ? "fn-nothis" : "fn-this"; }`;
const packages: Record<string, string> = {
  "node_modules/react/package.json": `{ "name": "react", "version": "19.0.0", "main": "index.js" }`,
  // `exports.x = ...`: the file becomes ESM and every export is its own binding.
  "node_modules/react/index.js": `"use strict"; exports.v = "react"; exports.w = "w"; exports.fn = ${fn}; exports.a = { b: "ab", c: function () { return "ac:" + this.b; } };`,
  "node_modules/scheduler/package.json": `{ "name": "scheduler", "version": "0.25.0", "main": "index.js" }`,
  // `module.exports = ...`: the file stays a `__commonJS` wrapper.
  "node_modules/scheduler/index.js": `"use strict"; module.exports = { v: "sched", w: "w", fn: ${fn}, a: { b: "sab", c: function () { return "sac:" + this.b; } } };`,
};

// `kinds`: the declaration kinds the rebind is valid for (default: var, let). `writes`: the rebind runs and stores
// another value.
type Rebind = { code: (x: string, out: string) => string; kinds?: string[]; eval?: boolean; writes?: boolean };
// `mk(out)` is the value a rebind stores. Its getter `g` logs a read that is a statement, and its `fn` tells
// `x.fn()` from `(0, x.fn)()`.
const rebinds: Record<string, Rebind> = {
  none: { code: () => ``, kinds: ["var", "let", "const"] },
  assign: { code: (x, out) => `${x} = mk(${out});`, writes: true },
  closure: { code: (x, out) => `(function () { ${x} = mk(${out}); })();`, writes: true },
  arrayPattern: { code: (x, out) => `[${x}] = [mk(${out})];`, writes: true },
  objectPattern: { code: (x, out) => `({ a: ${x} } = { a: mk(${out}) });`, writes: true },
  forOf: { code: (x, out) => `for (${x} of [mk(${out})]) {}`, writes: true },
  logical: { code: (x, out) => `${x} &&= mk(${out});`, writes: true },
  // A write that never runs: the variable still holds the namespace.
  neverFn: { code: (x, out) => `function never_${x}() { ${x} = mk(${out}); }` },
  neverArrow: { code: (x, out) => `var never_${x} = () => { ${x} = mk(${out}); };` },
  deadFalse: { code: (x, out) => `if (false) { ${x} = mk(${out}); }` },
  neverBranch: { code: (x, out) => `if (${out}.length > 99) { ${x} = mk(${out}); }` },
  evalWrite: { code: (x, out) => `eval("${x} = mk(${out})");`, eval: true, writes: true },
  evalRead: { code: (x, out) => `${out}.push(eval("${x}.v"));`, eval: true, kinds: ["var", "let", "const"] },
};

const reads: Record<string, (x: string, out: string) => string> = {
  oneLevel: (x, out) => `${out}.push(${x}.v);`,
  index: (x, out) => `${out}.push(${x}["w"]);`,
  indexEmpty: (x, out) => `${out}.push(${x}[""]);`,
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

// "top" is the module scope and "topBlock" a block in it. The others wrap the cell in a function.
const scopes: Record<string, (body: string) => string> = {
  topBlock: body => `{ ${body} }`,
  fn: body => `(function () { ${body} })();`,
  arrow: body => `(() => { ${body} })();`,
  method: body => `({ m() { ${body} } }).m();`,
  staticBlock: body => `(class { static { ${body} } });`,
  nestedFn: body => `(function outer() { var unrelated = 1; (function inner() { ${body} })(); return unrelated; })();`,
  fnBlock: body => `(function () { if (out) { ${body} } })();`,
  elseIf: body => `(function () { if (!out) { out.push("no"); } else if (out) { ${body} } })();`,
  loopBody: body => `(function () { for (const once of [1]) { ${body} } })();`,
  switchCase: body => `(function () { switch (out.length) { case 0: ${body} } })();`,
};

// The order of the declaration, the rebind and the read in the source. The read always runs after the rebind.
const orders: Record<string, (decl: string, rebind: string, read: string, id: string) => string> = {
  writeFirst: (decl, rebind, read) => `${decl} ${rebind} ${read}`,
  // The bundler visits the read before the rebind.
  readInEarlierFn: (decl, rebind, read, id) => `${decl} function rd${id}() { ${read} } ${rebind} rd${id}();`,
  hoistedWriter: (decl, rebind, read, id) => `${decl} wr${id}(); ${read} function wr${id}() { ${rebind} }`,
};

export type Options = {
  packages?: string[];
  kinds?: string[];
  rebinds?: string[];
  reads?: string[];
  scopes?: string[];
  orders?: string[];
};

type Cell = { name: string; pkg: string; kind: string; rebind: string; read: string; scope: string; order: string };

// A `var` in one of these is declared by the function, so the bundler never takes it for the namespace.
const blockScopes = ["topBlock", "fnBlock", "elseIf", "loopBody", "switchCase"];

// The cells whose bundle is known to differ from the unbundled run.
export function knownGap(cell: Cell, minified: boolean): boolean {
  // As on main, and not about a rebind: `minify` drops the `(0, ...)` of a call through a variable that became the
  // namespace of a package that stays a wrapper. The call gets the namespace as `this`.
  if (cell.pkg === "scheduler" && cell.rebind === "none" && cell.read === "commaCall") {
    return minified && !(cell.kind === "var" && blockScopes.includes(cell.scope));
  }
  // A read that the bundler visits before the rebind is an import item by then. It prints as the property read that
  // was written, but a read whose value is unused is removed when it is a statement of the module: the getter of
  // the new value does not run.
  const isStatementOfModule = cell.read === "stmt" && cell.scope === "top" && cell.order === "hoistedWriter";
  return isStatementOfModule && !!rebinds[cell.rebind].writes;
}

const cellsPerBundle = 1000;

const prelude =
  `"use strict";\n` +
  `const cells = (globalThis.__cells ??= {});\n` +
  `const mk = out => ({ v: "N", w: "Nw", "": "Nempty", fn() { return this === undefined ? "N-nothis" : "N-this:" + this.v; }, a: { b: "Nab", c() { return "Nac:" + this.b; } }, get g() { out.push("Ngetter"); return 1; } });\n`;

export function generate(options: Options = {}): { files: Record<string, string>; cells: Cell[] } {
  const kinds = options.kinds ?? ["var", "let", "const"];
  const files: Record<string, string> = { ...packages };
  let [fnSource, evalSource, topSource] = [prelude, prelude, prelude];
  let bundles = 0;
  const endBundle = () => {
    files[`fn${bundles}.js`] = fnSource;
    files[`eval${bundles}.js`] = evalSource;
    files[`top${bundles}.js`] = topSource;
    files[`entry${bundles}.mjs`] =
      `import "./fn${bundles}.js";\nimport "./eval${bundles}.js";\nimport "./top${bundles}.js";\n`;
    [fnSource, evalSource, topSource] = [prelude, prelude, prelude];
    bundles++;
  };
  const cells: Cell[] = [];
  for (const pkg of options.packages ?? ["react", "scheduler"]) {
    for (const kind of kinds) {
      for (const rebindName of options.rebinds ?? Object.keys(rebinds)) {
        const rebind = rebinds[rebindName];
        if (!(rebind.kinds ?? ["var", "let"]).includes(kind)) continue;
        for (const read of options.reads ?? Object.keys(reads)) {
          for (const scope of options.scopes ?? ["top", ...Object.keys(scopes)]) {
            for (const order of options.orders ?? Object.keys(orders)) {
              // Without a rebind the three orders are one program.
              if (rebindName === "none" && order !== "writeFirst") continue;
              const isTop = scope === "top" || scope === "topBlock";
              // A direct eval at the top level makes the whole file a `__commonJS` wrapper.
              if (isTop && rebind.eval) continue;
              if (cells.length > 0 && cells.length % cellsPerBundle === 0) endBundle();
              const name = [pkg, kind, rebindName, read, scope, ...(order === "writeFirst" ? [] : [order])].join("_");
              // A variable of the module has its own name. So do the functions beside it.
              const id = isTop ? String(cells.length) : "";
              const [x, out] = isTop ? [`x${id}`, `o${id}`] : ["x", "out"];
              cells.push({ name, pkg, kind, rebind: rebindName, read, scope, order });
              const body = orders[order](
                `${kind} ${x} = require("${pkg}");`,
                rebind.code(x, out),
                isTop
                  ? `try { ${reads[read](x, out)} } catch (e) { ${out}.push("threw " + e.name); }`
                  : reads[read](x, out),
                id,
              );
              if (isTop) {
                topSource +=
                  `const ${out} = (cells[${JSON.stringify(name)}] = []);\n` +
                  `${scope === "top" ? body : scopes[scope](body)}\n`;
                continue;
              }
              const cell = `{ const out = (cells[${JSON.stringify(name)}] = []); try { ${scopes[scope](body)} } catch (e) { out.push("threw " + e.name); } }\n`;
              if (rebind.eval) evalSource += cell;
              else fnSource += cell;
            }
          }
        }
      }
    }
  }
  endBundle();
  // One process runs each program unbundled, then builds and runs its two bundles.
  files["run.mjs"] = `
    const runs = { unbundled: {}, plain: {}, minified: {} };
    const run = async (name, file) => {
      if (typeof runs[name] !== "object") return;
      globalThis.__cells = runs[name];
      try {
        await import(file);
      } catch (e) {
        runs[name] = String(e);
      }
    };
    for (let bundle = 0; bundle < ${bundles}; bundle++) {
      await run("unbundled", import.meta.dir + "/entry" + bundle + ".mjs");
      for (const minify of [false, true]) {
        const name = minify ? "minified" : "plain";
        // A directory of its own. On Windows, the import of a file that is new in a directory the module loader
        // has read before fails with "Cannot find module" (a defect of the loader, not of the bundler).
        const outdir = import.meta.dir + "/" + name + bundle;
        const result = await Bun.build({
          entrypoints: [import.meta.dir + "/entry" + bundle + ".mjs"],
          outdir,
          minify,
          throw: false,
        });
        if (result.success) await run(name, outdir + "/entry" + bundle + ".js");
        else runs[name] = result.logs.join("\\n");
      }
    }
    console.log(JSON.stringify(runs));
  `;
  return { cells, files };
}

type Unexpected = Record<string, { unbundled: unknown; bundled: unknown; knownGap: boolean }>;

/**
 * The cells that do not behave as expected, for the plain and the minified bundle: a cell outside `knownGap` whose
 * bundled run logs other values than the unbundled run, and a cell of `knownGap` whose runs agree.
 */
export async function checkMatrix(bun: string, options: Options = {}) {
  const matrix = generate(options);
  using dir = tempDir("unwrapped-require-matrix", matrix.files);
  await using proc = spawn({ cmd: [bun, "run.mjs"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error("the run failed: " + stderr.slice(0, 400));
  const runs = JSON.parse(stdout);
  if (typeof runs.unbundled !== "object") throw new Error("the unbundled run failed: " + runs.unbundled);

  const unexpected = (bundled: unknown, minified: boolean): Unexpected => {
    if (typeof bundled !== "object" || bundled === null) return { all: { unbundled: "ran", bundled, knownGap: false } };
    const result: Unexpected = {};
    for (const cell of matrix.cells) {
      const [expected, actual] = [runs.unbundled[cell.name], bundled[cell.name]];
      const gap = knownGap(cell, minified);
      if (Bun.deepEquals(actual, expected) === gap)
        result[cell.name] = { unbundled: expected, bundled: actual, knownGap: gap };
    }
    return result;
  };
  return {
    cells: matrix.cells.length,
    plain: unexpected(runs.plain, false),
    minified: unexpected(runs.minified, true),
  };
}

if (import.meta.main) {
  const result = await checkMatrix(process.argv[2] ?? bunExe(), JSON.parse(process.argv[3] ?? "{}"));
  for (const run of ["plain", "minified"] as const) {
    for (const [name, cell] of Object.entries(result[run])) console.log(run, name, JSON.stringify(cell));
  }
  console.log(
    `${result.cells} cells, unexpected: ${Object.keys(result.plain).length} plain, ${Object.keys(result.minified).length} minified`,
  );
}
