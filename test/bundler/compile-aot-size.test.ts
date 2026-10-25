import { readTrimTable } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/run-programs";
import { canTrim, featureNamed, getMappedSegments, model, tempDirForAotBuilds } from "./compile-trim-features";

// An AOT-compiled program never runs the CLI or the JIT, so --aot removes the code that only those two need.
const removedByAot = new Set(
  model.features.filter(each => each.enteredFrom === "command-line" || each.name === "JIT").map(each => each.index),
);

function measureFeature(name: string) {
  const { index } = model.features.find(each => each.name === featureNamed(name))!;
  const table = readTrimTable(bunExe());
  let totalBytes = 0;
  let removedBytes = 0;
  for (const { start, end, set } of table.ranges) {
    const users = table.sets[set]!;
    if (!users.includes(index)) continue;
    totalBytes += end - start;
    if (users.every(user => removedByAot.has(user))) removedBytes += end - start;
  }
  return { totalBytes, removedBytes };
}

const toolStrings: Record<string, string[]> = {
  "type checker": [
    "lib.es2015.promise.d.ts",
    "lib.webworker.importscripts.d.ts",
    "a conditional type saved its check type",
  ],
  "type checker's parser": [
    "A rest parameter must be last in a parameter list",
    "Type parameters cannot appear on a constructor declaration",
    "Line terminator not permitted before arrow",
  ],
  "linter": ["Unexpected any. Specify a different type."],
  "package manager": ["lockfile had changes, but lockfile is frozen"],
  "compiler": ["RequiredPassLeftOperation"],
};
const allToolStrings = Object.entries(toolStrings).flatMap(([tool, strings]) =>
  strings.map(each => `${tool}: ${each}`),
);
const findToolStrings = (file: Buffer) =>
  allToolStrings.filter(each => file.includes(each.slice(each.indexOf(": ") + 2)));

const countMappedBytes = (file: Buffer) => getMappedSegments(file).reduce((sum, segment) => sum + segment.length, 0);

const importsItsArguments = `
  import { join } from "node:path";
  for (const name of process.argv.slice(2)) {
    console.log(name + ":", ...(await import(join(process.cwd(), name))).output);
  }
`;

const filesOnDisk = {
  "plain.ts": `export const output: string[] = ["loaded"];`,
};

describe.skipIf(!canTrim)("bun build --compile --aot", () => {
  test.each([
    ["Check", 0.85],
    ["Lint", 0.85],
    ["Fmt", 0.85],
    ["ImageCompiler", 0.85],
    ["Tools", 0.65],
    ["AotCompiler", 0.65],
  ])("removes most of %s", (feature, minimumShare) => {
    const { totalBytes, removedBytes } = measureFeature(feature);
    expect(totalBytes).toBeGreaterThan(0);
    expect(removedBytes / totalBytes).toBeGreaterThanOrEqual(minimumShare);
  });

  describe.skipIf(!!unsupported).each([[[] as string[]], [["--trim"]]])("with %j", flags => {
    async function build(cwd: string, name: string, moreFlags: string[] = []) {
      const cmd = [bunExe(), "build", "--compile", "--aot", ...flags, ...moreFlags, `${name}.ts`, "--outfile", name];
      const { stderr, exitCode } = await spawned(cmd, cwd, bunEnv);
      expect(stderr).not.toMatch(/^error\b/m);
      expect(exitCode).toBe(0);
      return join(cwd, name + (isWindows ? ".exe" : ""));
    }

    test("hello world contains no strings from the CLI tools", async () => {
      using dir = tempDirForAotBuilds("compile-aot-size", { "hello.ts": `console.log("hello world");` });
      const hello = await build(String(dir), "hello");
      expect(await spawned([hello], String(dir), bunEnv)).toMatchObject({ stdout: "hello world\n", exitCode: 0 });
      const bun = readFileSync(bunExe());
      const executable = readFileSync(hello);
      expect(findToolStrings(bun)).toEqual(allToolStrings);
      expect(findToolStrings(executable)).toEqual([]);
      if (isLinux) expect(countMappedBytes(executable) / countMappedBytes(bun)).toBeLessThan(0.53);
    }, 600_000);

    test("loads a TypeScript file imported at run time", async () => {
      using dir = tempDirForAotBuilds("compile-aot-size", { "program.ts": importsItsArguments, "cwd/empty": "" });
      const cwd = join(String(dir), "cwd");
      const program = await build(String(dir), "program", ["--aot-allow-code-from-disk"]);
      for (const [name, text] of Object.entries(filesOnDisk)) writeFileSync(join(cwd, name), text);
      const { stdout, exitCode } = await spawned([program, ...Object.keys(filesOnDisk)], cwd, bunEnv);
      expect(stdout).toBe("plain.ts: loaded\n");
      expect(exitCode).toBe(0);
    }, 600_000);
  });
});
