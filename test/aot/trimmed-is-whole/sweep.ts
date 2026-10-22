import { Bench, programsOf, type Case, type Program } from "./environment";
import { cases, casesOfOptions, casesOfOtherOptions, casesOfVariables } from "./environment-cases";
import { tls } from "harness";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [bun, folder, out, which = "curated", list] = process.argv.slice(2);
if (!out) {
  console.error("usage: bun sweep.ts <a Bun that can trim> <an empty folder> <out.tsv> [curated | options | others | variables | jsc]");
  process.exit(1);
}
const env = { PATH: "/usr/bin:/bin", HOME: folder + "/home", TMPDIR: folder + "/tmp", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", WTF_numberOfProcessorCores: "8" };
Bun.spawnSync({ cmd: ["mkdir", "-p", folder + "/home", folder + "/tmp"] });
const bench = new Bench(bun, folder, env, tls);
bench.buildsAtOnce = Number(process.env.BUILDS ?? 1);
bench.trimWithout = (process.env.WITHOUT ?? "").split(",").filter(Boolean);
let chosen: Case[] = cases;
if (which === "options") {
  const help = Bun.spawnSync({ cmd: [bun, "run", "--help"], env: { ...env, NO_COLOR: "1" } }).stdout.toString();
  const found = new Map<string, boolean>();
  for (const match of help.matchAll(/^\s+(?:-\w, )?(--[a-z0-9-]+)(=\S+)?/gm)) found.set(match[1], !!match[2]);
  chosen = casesOfOptions([...found].map(([name, takesValue]) => ({ name, takesValue })));
} else if (which === "others") {
  chosen = casesOfOtherOptions;
} else if (which === "variables") {
  chosen = casesOfVariables(readFileSync(list ?? import.meta.dir + "/variables.txt", "utf8").split(/\s+/).filter(Boolean));
} else if (which === "jsc") {
  const dumped = Bun.spawnSync({ cmd: [await bench.executable("hello", "whole")], env: { ...env, BUN_JSC_dumpOptions: "3" } });
  const text = dumped.stderr.toString() + dumped.stdout.toString();
  chosen = [];
  for (const match of text.matchAll(/^\s*(\w+)=(\S*)/gm)) {
    const [, name, value] = match;
    const others = value === "true" ? ["false"] : value === "false" ? ["true"] : /^-?\d/.test(value) ? ["0", "1", "1000"] : ["x"];
    for (const other of others) chosen.push({ name: `BUN_JSC_${name}=${other}`, env: { ["BUN_JSC_" + name]: other }, programs: ["hello", "serve", "throws"] });
  }
}
writeFileSync(out, "");
if (process.env.ONLY) chosen = chosen.filter(it => new RegExp(process.env.ONLY!).test(it.name));
const jobs: [Case, Program][] = chosen.flatMap(it => programsOf(it).map(program => [it, program] as [Case, Program]));
console.log(jobs.length, "runs of two");
let next = 0, differ = 0;
const short = (text: string) => JSON.stringify(text.length > 400 ? text.slice(0, 400) + ".." : text);
await Promise.all(
  Array.from({ length: Number(process.env.JOBS ?? 12) }, async () => {
    while (next < jobs.length) {
      const [it, program] = jobs[next++];
      try {
        const { whole, trimmed } = await bench.both(program, it);
        let keys = (Object.keys(whole) as (keyof typeof whole)[]).filter(key => whole[key] !== trimmed[key]);
        const loose = (text: string) => text.replace(/\d+/g, "N");
        const butForNumbers = keys.length > 0 && keys.every(key => loose(whole[key]) === loose(trimmed[key]));
        if (butForNumbers) keys = [];
        if (keys.length) differ++;
        appendFileSync(out, [keys.length ? "DIFFERS" : butForNumbers ? "same but for numbers" : "same", it.name, program, "exit " + whole.exit + " | " + trimmed.exit, ...keys.map(key => `${key}: ${short(whole[key])} | ${short(trimmed[key])}`), ...(keys.length ? [] : [short(whole.stdout.slice(0, 120)), short(whole.stderr.slice(0, 160)), whole.written, short(whole.answers.slice(-200))])].join("\t") + "\n");
      } catch (error) {
        appendFileSync(out, ["FAILED", it.name, program, String(error).slice(0, 300).replaceAll("\n", " ")].join("\t") + "\n");
      }
    }
  }),
);
bench.stop();
console.log("AUDIT-DONE", jobs.length, "runs,", differ, "differ");
