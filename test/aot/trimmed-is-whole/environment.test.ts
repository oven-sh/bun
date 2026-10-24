import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";
import { canTrim } from "../../bundler/compile-trim-features";
import { unsupported } from "../run-programs";
import { Bench, programsOf, type Case } from "./environment";
import { cases, casesOfOptions, casesOfOtherOptions, knownToDiffer, refused } from "./environment-cases";

const dir = tempDir("trimmed-is-whole-environment", { "home/keep": "", "tmp/keep": "" });
const folder = String(dir);

const help = Bun.spawnSync({
  cmd: [bunExe(), "run", "--help"],
  env: { ...bunEnv, NO_COLOR: "1" },
  stdout: "pipe",
  stderr: "pipe",
}).stdout.toString();
const options = new Map<string, boolean>();
for (const [, name, value] of help.matchAll(/^\s+(?:-\w, )?(--[a-z0-9-]+)(=\S+)?/gm)) options.set(name, !!value);

const bench = new Bench(
  bunExe(),
  folder,
  {
    PATH: "/usr/bin:/bin",
    HOME: folder + "/home",
    TMPDIR: folder + "/tmp",
    BUN_ENABLE_CRASH_REPORTING: "0",
    DO_NOT_TRACK: "1",
    BUN_DEBUG_QUIET_LOGS: "1",
  },
  tls,
);
afterAll(() => {
  bench.stop();
  dir[Symbol.dispose]();
});

const all: Case[] = [
  ...cases,
  ...casesOfOptions(
    [...options].map(([name, takesValue]) => ({ name, takesValue })),
    ["hello"],
  ),
  ...casesOfOtherOptions.map(it => ({ ...it, programs: ["hello" as const] })),
];

(!canTrim || unsupported || isWindows ? describe.skip : describe.concurrent)(
  "a trimmed executable does in every environment what the whole one does",
  () => {
    for (const it of all.filter(it => !refused.test(it.name))) {
      const [, why] = knownToDiffer.find(([name]) => name.test(it.name)) ?? [];
      for (const program of programsOf(it)) {
        test(`${program}: ${it.name}${why ? ` (differs: ${why})` : ""}`, async () => {
          const { whole, trimmed } = await bench.both(program, it);
          if (why) expect(trimmed).not.toEqual(whole);
          else expect(trimmed).toEqual(whole);
        }, 600_000);
      }
    }
  },
);
