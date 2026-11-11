import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("the table of flags for shell completions lists every --aot flag of bun build", async () => {
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--help"], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [help, errors, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  const inHelp = [
    ...new Set(
      [
        ...(help + errors).matchAll(
          /^\s+--(aot[a-z-]*|dts|explain|no-compile-function-source|compile-in-place|compile-inspector|obfuscate|trim(?:-locales)?)(?![a-z-])/gm,
        ),
      ].map(match => match[1]),
    ),
  ];
  expect(inHelp).toEqual(expect.arrayContaining(["aot", "aot-huge-heap", "dts", "explain", "compile-inspector"]));
  const table = await Bun.file(join(import.meta.dir, "..", "..", "completions", "bun-cli.json")).json();
  const inTable: string[] = table.commands.build.flags.map((flag: { name: string }) => flag.name);
  expect(inHelp.filter(name => !inTable.includes(name))).toEqual([]);
  const removed = ["admit", "aot-type-errors", "aot-audit", "aot-log-type-mismatches"];
  expect(inTable.filter(name => removed.includes(name))).toEqual([]);
  expect(exitCode).toBe(0);
});

test.each([
  ["bun.bash", /(?<=[ "])--([\w-]+)(?=[ "])/g],
  ["bun.fish", / -l "([\w-]+)"/g],
  ["bun.zsh", /'--([\w-]+)\[/g],
])("%s offers every --aot flag of bun compile", async (file, offeredFlag) => {
  await using compile = Bun.spawn({
    cmd: [bunExe(), "compile", "--help"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [help, errors, exitCode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
  const inHelp = [...new Set([...(help + errors).matchAll(/^\s+--(aot-[a-z-]+)(?![a-z-])/gm)].map(match => match[1]))];
  expect(inHelp).toContain("aot-huge-heap");
  const completions = await Bun.file(join(import.meta.dir, "..", "..", "completions", file)).text();
  const offered = new Set([...completions.matchAll(offeredFlag)].map(match => match[1]));
  expect(inHelp.filter(name => !offered.has(name))).toEqual([]);
  expect(completions).not.toContain("aot-log-type-mismatches");
  expect(exitCode).toBe(0);
});
