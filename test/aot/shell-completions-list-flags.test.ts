import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("the table of flags for shell completions lists every --aot flag of bun build", async () => {
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--help"], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [help, errors, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  const inHelp = [...new Set([...(help + errors).matchAll(/^\s+--(aot[a-z-]*|(?:no-)?compile-function-source|dts)\b/gm)].map(match => match[1]))];
  expect(inHelp).toContain("aot");
  const table = await Bun.file(join(import.meta.dir, "..", "..", "completions", "bun-cli.json")).json();
  const inTable = table.commands.build.flags.map((flag: { name: string }) => flag.name);
  expect(inHelp.filter(name => !inTable.includes(name))).toEqual([]);
  expect(exitCode).toBe(0);
});
