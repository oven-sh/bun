// Under an error Bun prints the lines of the file that threw it. An executable holds no text of a compiled module: it finds the
// file again under the folder it runs in, where that is the folder it was built in, and prints the error without the lines
// anywhere else. The file is read as it is: nothing is parsed.
import { expect } from "bun:test";
import { realpathSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  "app/src/deep.ts": `export function deep(n: number): number {
  if (n === 0) throw new TypeError("at the bottom");
  return deep(n - 1) + 1;
}
`,
  "app/main.ts": `import { deep } from "./src/deep";
try {
  deep(2);
} catch (error) {
  console.log(Bun.inspect(error));
}
console.error(new RangeError("printed"));
deep(3);
`,
  "elsewhere/empty.txt": "",
};

const shown = `1 | export function deep(n: number): number {
2 |   if (n === 0) throw new TypeError("at the bottom");
                             ^
TypeError: at the bottom
      at deep (/$bunfs/root/src/deep.ts:2:26)`;

test("the lines under an error come from the file on disk, unparsed", async () => {
  using dir = tempDir("source-lines-under-an-error", files);
  const root = realpathSync(String(dir));
  const env = { ...bunEnv, NO_COLOR: "1" };
  const executable = join(root, "program");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      join(root, "app"),
      env,
    ),
  );

  const whereBuilt = await spawned([executable], join(root, "app"), env);
  expect(whereBuilt.stdout).toStartWith(shown);
  expect(whereBuilt.stderr).toContain(
    `7 | console.error(new RangeError("printed"));\n                      ^\nRangeError: printed\n`,
  );
  expect(whereBuilt.stderr).toContain(shown);
  expect(whereBuilt.exitCode).toBe(1);

  const elsewhere = await spawned([executable], join(root, "elsewhere"), env);
  expect(elsewhere.stdout).toStartWith("TypeError: at the bottom\n      at deep (/$bunfs/root/src/deep.ts:2:26)");
  expect(elsewhere.stderr).toStartWith("RangeError: printed\n      at /$bunfs/root/main.ts:7:19");
  expect(elsewhere.stderr).not.toContain(" | ");
  expect(elsewhere.exitCode).toBe(1);

  writeFileSync(join(root, "app/src/deep.ts"), "this is (( not a program\nnor is this {{\n");
  writeFileSync(join(root, "app/src/package.json"), "{ nor is this JSON");
  const unparsed = await spawned([executable], join(root, "app"), env);
  expect(unparsed.stdout).toStartWith(`1 | this is (( not a program\n2 | nor is this {{\n`);
  expect(unparsed.stdout).toContain("TypeError: at the bottom\n      at deep (/$bunfs/root/src/deep.ts:2:26)");
  expect(unparsed.exitCode).toBe(1);
});
