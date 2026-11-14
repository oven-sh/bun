// Each variant: async (graph, dir) => absolute path of the module to import().
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emitSpecEmu } from "./spec-model.mjs";
import { bodyLines, hasTLA, names } from "./gen.mjs";
import { emitProto2, emitSplit } from "./plan-linker.mjs";

const sh = (cmd, argv, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (out += d));
    p.on("error", reject);
    p.on("close", code =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${out.slice(0, 800)}`)),
    );
  });

const src = dir => path.join(dir, "src", "m0.mjs");
const outdir = (dir, name) => {
  const d = path.join(dir, "out-" + name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

export const VARIANTS = {
  node: async (g, dir) => src(dir),
  bun: async (g, dir) => src(dir),

  spec: async (g, dir) => {
    const f = path.join(outdir(dir, "spec"), "m0.mjs");
    fs.writeFileSync(f, emitSpecEmu(g));
    return f;
  },

  plan: async (g, dir) => {
    const f = path.join(outdir(dir, "plan"), "m0.mjs");
    fs.writeFileSync(f, emitProto2(g));
    return f;
  },
  planall: async (g, dir) => {
    const f = path.join(outdir(dir, "planall"), "m0.mjs");
    fs.writeFileSync(f, emitProto2(g, { allRec: true }));
    return f;
  },
  planfast: async (g, dir) => {
    const f = path.join(outdir(dir, "planfast"), "m0.mjs");
    fs.writeFileSync(f, emitProto2(g, { relaxed: true }));
    return f;
  },
  // every module that reaches an await gets a node, also the ones that evaluate nothing
  plankeep: async (g, dir) => {
    const f = path.join(outdir(dir, "plankeep"), "m0.mjs");
    fs.writeFileSync(f, emitProto2(g, { elide: false }));
    return f;
  },
  plannode: async (g, dir) => {
    const f = path.join(outdir(dir, "plannode"), "m0.mjs");
    fs.writeFileSync(f, emitProto2(g, { entry: "node" }));
    return f;
  },

  plansplit: async (g, dir) => {
    const o = outdir(dir, "plansplit");
    for (const [name, text] of Object.entries(emitSplit(g))) fs.writeFileSync(path.join(o, name), text);
    return path.join(o, "m0.mjs");
  },
  plansplitall: async (g, dir) => {
    const o = outdir(dir, "plansplitall");
    for (const [name, text] of Object.entries(emitSplit(g, { allRec: true })))
      fs.writeFileSync(path.join(o, name), text);
    return path.join(o, "m0.mjs");
  },

  // evanw/tla-fuzzer strategy.registry.js, verbatim algorithm
  registry: async (g, dir) => {
    const f = path.join(outdir(dir, "registry"), "m0.mjs");
    let js = `
    let modules = {}
    function register(name, imports, fn) { modules[name] = { fn, state: 'ready', imports, whenDone: [], remaining: 1 } }
    function evaluate(name, whenDone, stack = []) {
      let module = modules[name]
      if (module.state === 'done') { whenDone(); return }
      module.whenDone.push(whenDone)
      if (module.state === 'busy') return
      module.state = 'busy'
      let moduleDone = () => { module.state = 'done'; for (let x of module.whenDone) x() }
      let importDone = () => {
        if (--module.remaining !== 0) return
        let result = module.fn()
        if (result) result.then(moduleDone)
        else moduleDone()
      }
      stack = stack.concat(name)
      for (let i of module.imports) {
        if (stack.includes(i)) continue
        module.remaining++
        evaluate(i, importDone, stack)
      }
      importDone()
    }
    var ${g.mods.flatMap(names).join(", ")};\n`;
    for (const m of g.mods)
      js += `register("${m.id}", ${JSON.stringify(m.imports.map(i => g.mods[i].id))}, ${hasTLA(m) ? "async " : ""}() => {\n${bodyLines(g, m, () => "0").join("\n")}\n})\n`;
    js += `await new Promise(resolve => evaluate("m0", resolve))\n`;
    fs.writeFileSync(f, js);
    return f;
  },

  bunbuild: async (g, dir) => {
    const o = outdir(dir, "bunbuild");
    await sh(process.env.BUN_BUILD_BIN ?? "bun", [
      "build",
      src(dir),
      "--outfile",
      path.join(o, "m0.mjs"),
      "--target=node",
      "--format=esm",
    ]);
    return path.join(o, "m0.mjs");
  },
  // a released bun, for before/after tables
  bunold: async (g, dir) => {
    const o = outdir(dir, "bunold");
    await sh(process.env.BUN_OLD_BIN ?? "bun", [
      "build",
      src(dir),
      "--outfile",
      path.join(o, "m0.mjs"),
      "--target=node",
      "--format=esm",
    ]);
    return path.join(o, "m0.mjs");
  },
  bunsplit: async (g, dir) => {
    const o = outdir(dir, "bunsplit");
    await sh(process.env.BUN_BUILD_BIN ?? "bun", [
      "build",
      src(dir),
      "--outdir",
      o,
      "--splitting",
      "--target=node",
      "--format=esm",
      "--entry-naming=[name].mjs",
      "--chunk-naming=[name]-[hash].mjs",
    ]);
    return path.join(o, "m0.mjs");
  },

  esbuild: async (g, dir) => {
    const o = outdir(dir, "esbuild");
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [src(dir)],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: path.join(o, "m0.mjs"),
      logLevel: "silent",
    });
    return path.join(o, "m0.mjs");
  },
  esbuildsplit: async (g, dir) => {
    const o = outdir(dir, "esbuildsplit");
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [src(dir)],
      bundle: true,
      format: "esm",
      platform: "node",
      splitting: true,
      outdir: o,
      outExtension: { ".js": ".mjs" },
      logLevel: "silent",
    });
    return path.join(o, "m0.mjs");
  },

  rollup: async (g, dir) => {
    const o = outdir(dir, "rollup");
    const { rollup } = await import("rollup");
    const b = await rollup({ input: src(dir), onwarn() {}, treeshake: true });
    await b.write({ file: path.join(o, "m0.mjs"), format: "es", inlineDynamicImports: true });
    await b.close();
    return path.join(o, "m0.mjs");
  },
  rollupsplit: async (g, dir) => {
    const o = outdir(dir, "rollupsplit");
    const { rollup } = await import("rollup");
    const b = await rollup({ input: src(dir), onwarn() {} });
    await b.write({ dir: o, format: "es", entryFileNames: "[name].mjs", chunkFileNames: "[name]-[hash].mjs" });
    await b.close();
    return path.join(o, "m0.mjs");
  },

  rolldown: async (g, dir) => {
    const o = outdir(dir, "rolldown");
    const { rolldown } = await import("rolldown");
    const b = await rolldown({ input: src(dir), logLevel: "silent", platform: "node" });
    await b.write({ file: path.join(o, "m0.mjs"), format: "esm", codeSplitting: false });
    await b.close();
    return path.join(o, "m0.mjs");
  },
  rolldownstrict: async (g, dir) => {
    const o = outdir(dir, "rolldownstrict");
    const { rolldown } = await import("rolldown");
    const b = await rolldown({ input: src(dir), logLevel: "silent", platform: "node" });
    await b.write({ file: path.join(o, "m0.mjs"), format: "esm", codeSplitting: false, strictExecutionOrder: true });
    await b.close();
    return path.join(o, "m0.mjs");
  },

  webpack: async (g, dir) => {
    const o = outdir(dir, "webpack");
    const { default: webpack } = await import("webpack");
    await new Promise((resolve, reject) =>
      webpack(
        {
          mode: "production",
          entry: src(dir),
          target: "node20",
          experiments: { outputModule: true },
          optimization: { minimize: false },
          output: {
            path: o,
            filename: "m0.mjs",
            chunkFilename: "[name]-[id].mjs",
            module: true,
            library: { type: "module" },
            chunkFormat: "module",
          },
        },
        (err, stats) =>
          err ? reject(err) : stats.hasErrors() ? reject(new Error(stats.toString("errors-only"))) : resolve(),
      ),
    );
    return path.join(o, "m0.mjs");
  },
  rspack: async (g, dir) => {
    const o = outdir(dir, "rspack");
    const { rspack } = await import("@rspack/core");
    await new Promise((resolve, reject) =>
      rspack(
        {
          mode: "production",
          entry: src(dir),
          target: "node20",
          optimization: { minimize: false },
          output: {
            path: o,
            filename: "m0.mjs",
            chunkFilename: "[name]-[id].mjs",
            module: true,
            library: { type: "module" },
            chunkFormat: "module",
          },
        },
        (err, stats) =>
          err ? reject(err) : stats.hasErrors() ? reject(new Error(stats.toString("errors-only"))) : resolve(),
      ),
    );
    return path.join(o, "m0.mjs");
  },
};
