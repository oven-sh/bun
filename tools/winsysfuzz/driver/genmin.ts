// Delta-minimize a generated crashing program to its smallest crashing form.
// Greedy line deletion, preamble included; a candidate is kept only if it
// still crashes with the SAME signature class. Every candidate run is
// bounded by a timeout (a program can wedge once a statement is removed) -
// a hang is "does not crash", never a stall.
//
//   bun driver/genmin.ts --bun <bun.exe> --in <program.js> --out <tiny.js>
//     [--timeout 15] [--class nullpage|heap|any]

import { join } from "node:path";
import { detectCrash } from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun")!;
const inFile = flag("--in")!;
const outFile = flag("--out")!;
const timeoutMs = 1000 * +(flag("--timeout", "15") as string);
const cls = (flag("--class", "any") as string).toLowerCase();
if (!bun || !inFile || !outFile) {
  console.error("usage: genmin.ts --bun <bun.exe> --in <program.js> --out <tiny.js> [--timeout 15] [--class ...]");
  process.exit(2);
}
const workDir = join(outFile, "..");
const cand = join(workDir, "genmin-cand.js");

async function crashes(lines: string[]): Promise<boolean> {
  await Bun.write(cand, lines.join("\n") + "\n");
  for (let k = 0; k < 2; k++) {
    const proc = Bun.spawn([bun, cand], { stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } });
    const timer = setTimeout(() => {
      try {
        if (proc.pid) Bun.spawnSync(["taskkill", "/F", "/PID", String(proc.pid), "/T"], { stdout: "ignore", stderr: "ignore" });
      } catch {}
    }, timeoutMs);
    const [so, se] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited.catch(() => {});
    clearTimeout(timer);
    const c = detectCrash(so, se);
    if (!c) continue;
    if (cls === "nullpage" && !/0xNULLPAGE/.test(c.signature)) continue;
    if (cls === "heap" && !/0xHEAP/.test(c.signature)) continue;
    return true;
  }
  return false;
}

let cur = (await Bun.file(inFile).text()).split("\n");
if (!(await crashes(cur))) {
  console.error("genmin: input program does not crash (with this class) - nothing to minimize");
  process.exit(1);
}
console.log(`genmin: start ${cur.length} line(s)`);
let changed = true;
while (changed) {
  changed = false;
  for (let i = 0; i < cur.length; ) {
    const trial = cur.filter((_, j) => j !== i);
    if (trial.length && (await crashes(trial))) {
      cur = trial;
      changed = true;
      console.log(`  dropped -> ${cur.length} line(s)`);
    } else i++;
  }
}
await Bun.write(outFile, cur.join("\n") + "\n");
console.log(`genmin: minimal ${cur.length} line(s) -> ${outFile}`);
