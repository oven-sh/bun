// node drive.cjs <bun> <firstSeed> <batches> <perBatch> <cells.json>
const { gen } = require("./gen.cjs");
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");
const [bun, first, batches, per, outFile] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], process.argv[6]];
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 300000 }); return r.status === 0 ? r.stdout : "EXIT " + r.status + " " + (r.stderr || "").split("\n").slice(0, 4).join(" | "); };
const harness = seeds => `\nconst results = {};\nfor (const [name, t] of Object.entries({ ${seeds.map(s => "test" + s).join(", ")} })) { results[name] = []; for (let v = 0; v < 4; v++) { try { results[name].push(t(v)); } catch (e) { results[name].push("THREW " + e.constructor.name); } } }\nconsole.log(JSON.stringify(results));\n`;
const cells = {};
for (let b = 0; b < batches; b++) {
  const seeds = Array.from({ length: per }, (_, i) => first + b * per + i);
  const progs = seeds.map(s => gen(s).src).join("\n");
  const dir = fs.mkdtempSync("/tmp/fz2/run-");
  const files = { "strict.mjs": progs + harness(seeds) + "export {};\n", "sloppy.cjs": progs + harness(seeds), "strict.cjs": '"use strict";\n' + progs + harness(seeds) };
  const want = {};
  for (const [f, text] of Object.entries(files)) { fs.writeFileSync(path.join(dir, f), text); want[f] = run("node", [f], dir); }
  const record = (mode, f, got) => {
    let w, g; try { w = JSON.parse(want[f]); } catch { w = null; } try { g = JSON.parse(got); } catch { g = null; }
    for (const s of seeds) cells[mode + "|" + s] = [w ? JSON.stringify(w["test" + s]) : "NODE " + want[f].slice(0, 80), g ? JSON.stringify(g["test" + s]) : "BUN " + got.slice(0, 160)];
  };
  for (const f of Object.keys(files)) record("run " + f, f, run(bun, [f], dir));
  for (const f of ["strict.mjs", "sloppy.cjs"]) for (const format of ["esm", "cjs", "iife"]) for (const minify of [[], ["--minify"]]) { if (f === "sloppy.cjs" && format === "iife") continue;
    const out = path.join(dir, `out-${f}-${format}${minify.length ? "-min" : ""}.${format === "esm" ? "mjs" : "cjs"}`);
    const built = run(bun, ["build", f, "--target=node", "--format=" + format, ...minify, "--outfile=" + out], dir);
    record(`bundle ${f} ${format}${minify.length ? " min" : ""}`, f, built.startsWith("EXIT") ? built : run("node", [out], dir));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
fs.writeFileSync(outFile, JSON.stringify(cells));
const bad = Object.values(cells).filter(c => c[0] !== c[1]).length;
console.log(`compared ${Object.keys(cells).length} program-mode cells, ${bad} differ`);
