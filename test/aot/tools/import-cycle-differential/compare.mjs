// Usage: bun compare.mjs <bun under test> <out.json> <dir>...
// For each program folder: what plain Bun prints (the reference) and what the executable built with --compile --aot prints.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [bun, outFile, ...dirs] = process.argv.slice(2);
const jobs = Number(process.env.JOBS ?? 8);

function run(cmd, args, cwd, env, ms) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), ms);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out });
    });
    child.on("error", error => {
      clearTimeout(timer);
      resolve({ code: -1, signal: null, out: String(error) });
    });
  });
}

async function one(dir) {
  if (existsSync(join(dir, "main.test.mjs"))) return oneTest(dir);
  const main = readdirSync(dir).find(name => /^main\.[cm]?[jt]s$/.test(name));
  if (!main) return { name: basename(dir), state: "no main" };
  const work = mkdtempSync(join(tmpdir(), "cmp-"));
  try {
    cpSync(dir, work, { recursive: true });
    const plain = await run(bun, [main], work, { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" }, 30000);
    const build = await run(bun, ["build", "--compile", "--aot", main, "--outfile", "a.out"], work, {}, 120000);
    if (build.code !== 0 || !existsSync(join(work, "a.out")))
      return { name: basename(dir), state: "build failed", plain: plain.out, build: build.out.slice(0, 2000) };
    const aot = await run(join(work, "a.out"), [], work, {}, 30000);
    const text = r => `${r.out}\n[exit ${r.code}${r.signal ? " " + r.signal : ""}]`;
    return { name: basename(dir), state: text(plain) === text(aot) ? "same" : "different", plain: text(plain), aot: text(aot) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// A test file: what `bun test` prints against what `bun test --aot` prints, without the times.
async function oneTest(dir) {
  const work = mkdtempSync(join(tmpdir(), "cmp-"));
  try {
    cpSync(dir, work, { recursive: true });
    const env = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1", NO_COLOR: "1" };
    const plain = await run(bun, ["test", "./main.test.mjs"], work, env, 60000);
    const aot = await run(bun, ["test", "--aot", "./main.test.mjs"], work, { NO_COLOR: "1" }, 180000);
    // The lines of the program and the result of the test: the runner writes its own lines to another stream, in another order.
    const text = r =>
      `${r.out
        .replace(/\[[\d.]+m?s\]/g, "[time]")
        .replaceAll(work, "<dir>")
        .split("\n")
        .filter(line => /^(m\d|main: |behind step|at the end|cache:|\(pass\)|\(fail\)|error|\s+at )/.test(line))
        .join("\n")}\n[exit ${r.code}${r.signal ? " " + r.signal : ""}]`;
    return { name: basename(dir), state: text(plain) === text(aot) ? "same" : "different", plain: text(plain), aot: text(aot) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < dirs.length) {
      const dir = dirs[next++];
      results.push(await one(dir));
    }
  }),
);
results.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(outFile, JSON.stringify(results, null, 1));
const count = state => results.filter(r => r.state === state).length;
console.log(`${results.length} programs: ${count("same")} same, ${count("different")} different, ${count("build failed")} build failed, ${count("no main")} no main`);
