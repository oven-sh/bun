// Bun.ModuleGraph stress: values of one graph used by other graphs and by the host in ~80 ways, while graphs are
// disposed mid-flight and replaced, graphs make graphs, and workers do the same. See scrambler/scrambler.mjs.
import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";

const slow = isDebug || isASAN;
// A callback that must run is given this long before it counts as lost: the run only waits that long when one is.
const knobs = slow
  ? { N: "4", ROUNDS: "40", HOT: "3000", LOST_MS: "60000" }
  : { N: "8", ROUNDS: "160", HOT: "20000", LOST_MS: "30000" };

function scramblerDir() {
  const dir = String(tempDir("module-graph-scrambler-", {}));
  cpSync(join(import.meta.dir, "scrambler"), dir, { recursive: true });
  // cell-copy.mjs: the same bytes under another specifier, so separate code. cell-variant.mjs: the same exports with
  // differently shaped functions, so graphs that share nothing but the protocol.
  let source = readFileSync(join(dir, "cell.mjs"), "utf8");
  writeFileSync(join(dir, "cell-copy.mjs"), source);
  const swap = (from: string, to: string) => {
    expect(source).toContain(from);
    source = source.replace(from, to);
  };
  swap(
    "probe: done => function probe() { here('probe'); state++; done(id); return id },",
    "probe: done => { const o = { run() { here('probe'); state += 1; done(id); return id } }; return (...a) => o.run(...a) },",
  );
  swap(
    "export const wrap = f => function wrapped(...a) { here('wrap:in'); const r = f.apply(this, a); here('wrap:out'); return r }",
    "export function wrap(f) { class Layer { #f = f; call(a) { here('wrap:in'); const r = this.#f(...a); here('wrap:out'); return r } } const l = new Layer(); return (...a) => l.call(a) }",
  );
  swap(
    "export const wrapTry = f => (...a) => { here('wrapTry:in'); try { return f(...a) } finally { here('wrapTry:finally') } }",
    "export const wrapTry = f => (...a) => { here('wrapTry:in'); let r; try { r = Reflect.apply(f, undefined, a) } finally { here('wrapTry:finally') } return r }",
  );
  swap("timeout: f => { setTimeout(f, 0) },", "timeout: f => { setTimeout(function () { return f() }, 0) },");
  swap("direct: f => { f(); after('direct') },", "direct: f => { (0, f)(); after('direct') },");
  writeFileSync(join(dir, "cell-variant.mjs"), source);
  return dir;
}

async function scramble(env: Record<string, string>) {
  const dir = scramblerDir();
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "scrambler.mjs")],
    env: { ...bunEnv, ...knobs, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Every line after the first is a broken invariant (or a worker's own result line, which starts with PASS too).
  const lines = stdout.trim().split("\n");
  expect({ problems: lines.filter(line => !/^\s*(PASS |workers=)/.test(line)), stderr }).toEqual({
    problems: [],
    stderr: "",
  });
  expect(lines[0]).toStartWith("PASS main ");
  expect(exitCode).toBe(0);
}

describe.concurrent("Bun.ModuleGraph scrambler", () => {
  // Graphs that all share one module's code, graphs that share none, and a mix.
  for (const mix of ["same", "distinct", "mixed"]) {
    test(`every piece of code runs as its own graph: ${mix} code`, () => scramble({ MIX: mix, SEED: "1" }), 120_000);
  }
  test(
    "and in workers, one of which is terminated and replaced mid-run",
    () => scramble({ WORKERS: "2", KILL: "1", SEED: "2", N: slow ? "4" : "6" }),
    180_000,
  );
});
