// Runs the top-level await tests of test262 unbundled and bundled.
//   node test262.mjs <test262 checkout> [variant=command ...]
//   node test262.mjs ~/test262 old="bun build" new="./build/debug/bun-debug build"
// A variant is a command that takes `<entry> --outfile <file> --format=esm --target=node`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

if (process.argv[2] === "--run") {
  // child: harness files as scripts, then the test as a module
  const [harness, includes, isAsync, file] = process.argv.slice(3);
  globalThis.print = s => console.log(s);
  for (const name of includes.split(",")) vm.runInThisContext(fs.readFileSync(path.join(harness, name), "utf8"));
  try {
    await import(pathToFileURL(file).href);
    if (isAsync !== "async") console.log("Test262:AsyncTestComplete");
  } catch (e) {
    console.log("Test262:AsyncTestFailure:" + e);
  }
} else {
  const [root, ...rest] = process.argv.slice(2);
  const variants = rest.map(v => v.split(/=(.*)/s));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tla-test262-"));
  // a copy, so that Node takes every .js file for a module
  const dir = path.join(work, "src");
  fs.cpSync(path.join(root, "test/language/module-code/top-level-await"), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), `{ "type": "module" }`);
  const sh = (cmd, args, timeout = 20000) =>
    new Promise(resolve => {
      const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", d => (out += d));
      p.stderr.on("data", d => (out += d));
      const timer = setTimeout(() => p.kill("SIGKILL"), timeout);
      p.on("close", code => (clearTimeout(timer), resolve({ code, out })));
    });
  const tally = {};
  const failures = {};
  const tests = fs.readdirSync(dir).filter(f => f.endsWith(".js") && !f.endsWith("_FIXTURE.js"));
  let count = 0;
  for (const name of tests) {
    const file = path.join(dir, name);
    const meta = /\/\*---([\s\S]*?)---\*\//.exec(fs.readFileSync(file, "utf8"))?.[1] ?? "";
    if (/^negative:/m.test(meta) || !/flags:.*\bmodule\b/.test(meta)) continue;
    count++;
    const isAsync = /flags:.*\basync\b/.test(meta);
    const includes = ["assert.js", "sta.js", ...(isAsync ? ["doneprintHandle.js"] : [])];
    for (const m of /includes:\s*\[([^\]]*)\]/.exec(meta)?.[1].split(",") ?? []) includes.push(m.trim());
    const run = async entry => {
      const args = ["--run", path.join(root, "harness"), includes.join(","), isAsync ? "async" : "sync", entry];
      const { out } = await sh(process.execPath, [fileURLToPath(import.meta.url), ...args], 5000);
      if (out.includes("Test262:AsyncTestComplete")) return "";
      return (out.split("\n").find(line => /Error/.test(line)) ?? "no result").slice(0, 160);
    };
    const results = { unbundled: await run(file) };
    for (const [variant, command] of variants) {
      const outfile = path.join(work, variant, name.replace(/\.js$/, ".mjs"));
      const [cmd, ...args] = command.split(" ");
      const build = await sh(cmd, [...args, file, "--outfile", outfile, "--format=esm", "--target=node"]);
      results[variant] =
        build.code === 0 ? await run(outfile) : "build: " + build.out.trim().split("\n")[0].slice(0, 160);
    }
    for (const [variant, failure] of Object.entries(results)) {
      tally[variant] = (tally[variant] ?? 0) + (failure ? 0 : 1);
      if (failure) (failures[variant] ??= []).push(`${name}: ${failure}`);
    }
  }
  for (const [variant, passed] of Object.entries(tally)) {
    console.log(`${variant}: ${passed}/${count}`);
    for (const line of failures[variant] ?? []) console.log("  " + line);
  }
  fs.rmSync(work, { recursive: true, force: true });
}
