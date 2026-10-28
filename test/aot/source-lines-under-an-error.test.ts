// Under an error Bun prints the lines of the code that threw it. An executable opens no file to show them: what lies on the disk under the name of a
// module that is compiled into it is not what runs, whoever put it there. So it prints the same in every folder.
import { expect } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
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

const decoy = "DECOY one\nDECOY two\nDECOY three\nDECOY four\nDECOY five\nDECOY six\nDECOY seven\nDECOY eight\n";

test("an executable shows no file of the disk as its source", async () => {
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

  const elsewhere = await spawned([executable], join(root, "elsewhere"), env);
  // The root of what is embedded is B:/~BUN/root on Windows.
  const rooted = (text: string) =>
    text.replace(/B:[\\/]~BUN[\\/]root[\\/][^\s:]*/g, path => "/$bunfs/root/" + path.slice(13).replaceAll("\\", "/"));
  expect(rooted(elsewhere.stdout)).toContain("TypeError: at the bottom\n      at deep (/$bunfs/root/src/deep.ts:2:26)");
  expect(rooted(elsewhere.stderr)).toContain("RangeError: printed\n      at /$bunfs/root/main.ts:7:19");
  expect(elsewhere.exitCode).toBe(1);

  const whereBuilt = await spawned([executable], join(root, "app"), env);
  expect({ ...whereBuilt }).toEqual({ ...elsewhere });

  for (const folder of ["app", "elsewhere"]) {
    for (const name of ["main.ts", "deep.ts", "src/deep.ts", "src/main.ts", "root/main.ts", "root/src/deep.ts"]) {
      mkdirSync(dirname(join(root, folder, name)), { recursive: true });
      writeFileSync(join(root, folder, name), decoy);
    }
    const besideDecoys = await spawned([executable], join(root, folder), env);
    expect(besideDecoys.stdout + besideDecoys.stderr).not.toContain("DECOY");
    expect({ ...besideDecoys }).toEqual({ ...elsewhere });
  }
});
