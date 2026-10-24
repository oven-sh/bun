import { spawn } from "bun";
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "../aot/supported";

setDefaultTimeout(60_000);

const files = {
  "node.d.ts": `declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare const process: { pid: number };
`,
  "app.ts": `
import { readFileSync } from "node:fs";
class Vector {
  constructor(public x: number, public y: number) {}
  plus(other: Vector): Vector {
    return new Vector(this.x + other.x, this.y + other.y);
  }
}
function walk(steps: number): number {
  let at = new Vector(0, 0);
  const step = new Vector(1, 2);
  for (let i = 0; i < steps; i++) at = at.plus(step);
  return at.x + at.y;
}
const applied = Reflect.apply(Vector.prototype.plus, new Vector(1, 1), [new Vector(2, 2)]).x;
console.log(JSON.stringify({ pid: process.pid, walked: walk(1000), applied, maps: readFileSync("/proc/self/maps", "utf8") }));
`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
};

async function ran(env: Record<string, string>) {
  const dir = String(tempDir("compile-aot-perf-map", files));
  await using build = spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(buildErrors).not.toContain("error");
  expect(buildExitCode).toBe(0);
  await using run = spawn({
    cmd: [join(dir, "app")],
    cwd: dir,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const { pid, walked, maps } = JSON.parse(stdout) as { pid: number; walked: number; maps: string };
  expect(walked).toBe(3000);
  return { path: `/tmp/perf-${pid}.map`, maps };
}

test.if(isLinux)("BUN_JSC_useAOTPerfMap=1 writes a map that perf reads: names, in anonymous memory", async () => {
  const { path, maps } = await ran({ BUN_JSC_useAOTPerfMap: "1" });
  const map = readFileSync(path, "utf8");
  rmSync(path);
  const rows = map
    .trimEnd()
    .split("\n")
    .map(line => /^([0-9a-f]+) ([0-9a-f]+) (.+)$/.exec(line)!);
  expect(rows).not.toContain(null);
  const names = rows.map(row => row[3]);
  expect(names).toContain("walk app.ts:9");
  expect(names).toContain("plus app.ts:5");
  const ranges = rows
    .map(row => [parseInt(row[1], 16), parseInt(row[1], 16) + parseInt(row[2], 16)])
    .sort((a, b) => a[0] - b[0]);
  expect(ranges.slice(1).filter(([start], i) => start !== ranges[i][1])).toEqual([]);
  // Anonymous memory that two mappings share is listed under this name.
  const anonymous = maps
    .split("\n")
    .map(line => /^([0-9a-f]+)-([0-9a-f]+) r-xs \S+ \S+ \d+\s+\/dev\/zero \(deleted\)$/.exec(line))
    .filter(found => found !== null)
    .map(found => [BigInt("0x" + found[1]), BigInt("0x" + found[2])]);
  for (const [, start, size] of rows) {
    const from = BigInt("0x" + start);
    expect(anonymous.some(([low, high]) => low <= from && from + BigInt("0x" + size) <= high)).toBe(true);
  }
});

test.if(isLinux)("without it no map is written and the code stays file-backed", async () => {
  const { path, maps } = await ran({});
  expect(() => readFileSync(path)).toThrow();
  expect(maps.split("\n").filter(line => / r-xp \S+ \S+ 0\s*$/.test(line))).toEqual([]);
});
