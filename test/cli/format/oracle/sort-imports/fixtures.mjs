// Makes test cases of the plugins' own tests.
//
//   node fixtures.mjs --modules=<dir> --trivago=<checkout> --ianvs=<checkout> --out=cases.json
//
// - `tests/*/`: the files of each directory, with the options of its `ppsi.spec.*`.
// - `src/**/__tests__/*.ts`: every template literal with an import in it, with a few sets of options.
// What is expected is what the released plugin and Prettier make of them, not the snapshots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SETS, flags, load } from "./oracle.mjs";

const { named } = flags(process.argv.slice(2));
const { expected } = await load(named.modules);
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const PARSERS = { oxc: "babel", "oxc-ts": "typescript" };


const modules = fs.mkdtempSync(path.join(os.tmpdir(), "sort-imports-fixtures-"));
const cases = [];
async function add(plugin, name, filename, input, options) {
  const result = await expected(plugin, input, options, filename);
  cases.push({ plugin, name, filename: path.basename(filename), options, input, ...result });
}

for (const plugin of ["trivago", "ianvs"]) {
  const root = named[plugin];
  for (const directory of fs.readdirSync(path.join(root, "tests")).sort()) {
    const full = path.join(root, "tests", directory);
    const spec = fs.existsSync(full) && fs.statSync(full).isDirectory() && fs.readdirSync(full).find(name => name.startsWith("ppsi.spec."));
    if (!spec) continue;
    const calls = [];
    const code = fs.readFileSync(path.join(full, spec), "utf8").replace(/^import .*$/gm, "");
    // As a module of its own, which is given what the file takes from the tests' globals and from its imports.
    const module = path.join(modules, `${plugin}-${directory}.mjs`);
    fs.writeFileSync(module, `export default (run_spec, expectError, __dirname, plugin) => {\n${code}\n};\n`);
    (await import(pathToFileURL(module).href)).default(
      (_, parsers, options) => calls.push({ parsers, options }),
      () => {},
      full,
      null,
    );
    for (const { parsers, options } of calls) {
      const parser = PARSERS[parsers[0]] ?? parsers[0];
      if (!["babel", "babel-ts", "typescript", "flow"].includes(parser) || options.plugins) continue;
      for (const name of fs.readdirSync(full).sort()) {
        if (!EXTENSIONS.has(path.extname(name)) || name.startsWith("ppsi.spec.")) continue;
        const input = fs.readFileSync(path.join(full, name), "utf8").replace(/\r\n/g, "\n");
        await add(plugin, `tests/${directory}/${name}`, path.join(full, name), input, { tabWidth: 4, ...options, parser });
      }
    }
  }

  const snippets = new Set();
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (directory.endsWith("__tests__") && entry.name.endsWith(".ts"))
        for (const match of fs.readFileSync(full, "utf8").matchAll(/`((?:[^`\\]|\\.)*\bimport\b(?:[^`\\]|\\.)*)`/g))
          if (!match[1].includes("${")) snippets.add(match[1].replace(/\\(.)/g, "$1"));
    }
  };
  visit(path.join(root, "src"));
  let count = 0;
  for (const input of snippets) {
    count++;
    for (const [index, options] of SETS[plugin].entries())
      await add(plugin, `snippets/${count}/${index}`, `/snippets/${count}.ts`, input, { ...options, parser: "typescript" });
  }
}
fs.rmSync(modules, { recursive: true });
fs.writeFileSync(named.out, JSON.stringify(cases, null, 1));
const failed = cases.filter(it => it.error).length;
console.log(`${cases.length} cases, of which ${failed} are errors`);
