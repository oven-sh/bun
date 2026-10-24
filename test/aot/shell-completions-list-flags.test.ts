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
  expect(inHelp).toEqual(
    expect.arrayContaining(["aot", "aot-log-type-mismatches", "dts", "explain", "compile-inspector"]),
  );
  const table = await Bun.file(join(import.meta.dir, "..", "..", "completions", "bun-cli.json")).json();
  const inTable: string[] = table.commands.build.flags.map((flag: { name: string }) => flag.name);
  expect(inHelp.filter(name => !inTable.includes(name))).toEqual([]);
  expect(inTable.filter(name => name === "admit" || name === "aot-type-errors" || name === "aot-audit")).toEqual([]);
  expect(exitCode).toBe(0);
});
