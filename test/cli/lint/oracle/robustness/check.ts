// bun check.ts <bun-lint executable> <scratch directory> [--seconds=n] [--megabytes=n] [part of a name ..]
//
// Runs the cases of cases.ts with `<bun-lint> cli`, one after the other, each with a limit on time and on address space, and prints
// for each whether it reports what it is to report, and how long it took. To see that a case fails with the
// executable from before a fix and passes with the one from after it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cases } from "./cases";
import { configOf, verdict } from "./run";

const flags = process.argv.slice(2).filter(it => it.startsWith("--"));
const [binary, scratch, ...filters] = process.argv.slice(2).filter(it => !it.startsWith("--"));
const flag = (name: string, fallback: number) =>
  Number(flags.find(it => it.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
if (!binary || !scratch) {
  console.error(
    "usage: bun check.ts <bun-lint executable> <scratch directory> [--seconds=n] [--megabytes=n] [part of a name ..]",
  );
  process.exit(2);
}
const [seconds, megabytes] = [flag("seconds", 20), flag("megabytes", 4000)];

let failed = 0;
for (const [i, it] of cases.entries()) {
  if (filters.length && !filters.some(part => it.name.includes(part))) continue;
  const directory = join(scratch, `case-${i}`);
  mkdirSync(directory, { recursive: true });
  const [configName, config] = configOf(it);
  writeFileSync(join(directory, configName), config);
  writeFileSync(join(directory, it.file), it.text());
  const args = ["cli", "-c", configName, "--threads", "2", ...(it.args ?? ["-f", "unix"]), it.file];
  const started = performance.now();
  const proc = Bun.spawnSync({
    cmd: ["sh", "-c", `ulimit -c 0; ulimit -v ${megabytes * 1000}; exec "$0" "$@"`, binary, ...args],
    cwd: directory,
    env: { ...process.env, AGENT: "0", CLAUDECODE: undefined, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
  });
  const took = ((performance.now() - started) / 1000).toFixed(2);
  const wrong = verdict(it, proc.stdout.toString(), proc.exitCode, proc.signalCode ?? null, readFileSync(join(directory, it.file), "utf8"));
  rmSync(directory, { recursive: true, force: true });
  if (wrong) failed++;
  console.log(
    `${wrong ? "FAIL" : "ok  "} ${took.padStart(6)} s ${it.name}${wrong ? `: ${wrong}` : ""}`,
  );
}
process.exit(failed ? 1 : 0);
