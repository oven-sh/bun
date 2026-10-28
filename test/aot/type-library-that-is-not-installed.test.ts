import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: ["not-installed"],
  },
});

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const found = (said: string, category: string) =>
  [...said.matchAll(new RegExp(`\\b${category}:? (TS\\d+)`, "g"))].map(match => match[1]).sort();

const files = {
  "tsconfig.json": tsconfig,
  "needs-nothing.test.ts": `import { expect, test } from "bun:test";\ntest("needs nothing of it", () => {\n  expect(1 + 1).toBe(2);\n});\n`,
  "needs-a-name.test.ts": `import { expect, test } from "bun:test";\nconst value: DeclaredThere = { a: 1 };\ntest("never runs", () => {\n  expect(value.a).toBe(1);\n});\n`,
};

test("a type library that `types` names and that is not installed is a warning: only a file that uses a name of it is refused", async () => {
  using dir = tempDir("type-library-not-installed", files);
  const { said, exitCode } = await run(String(dir), "test", "--aot");
  expect(found(said, "warn")).toContain("TS2688");
  expect(found(said, "error")).toEqual(["TS2304"]);
  expect(passed(said)).toEqual(["needs nothing of it"]);
  expect(exitCode).toBe(1);
});

test("an executable is built in spite of it", async () => {
  using dir = tempDir("type-library-not-installed", { "tsconfig.json": tsconfig, "main.ts": `console.log(1 + 1);\n` });
  const built = await run(String(dir), "build", "--compile", "--aot", "main.ts", "--outfile", "program");
  expect(found(built.said, "error")).toEqual([]);
  expect(built.exitCode).toBe(0);
  await using proc = Bun.spawn({ cmd: [`${dir}/program`], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(await proc.stdout.text()).toBe("2\n");
}, 120_000);

test("bun check without --aot reports it as tsc does", async () => {
  using dir = tempDir("type-library-not-installed", { "tsconfig.json": tsconfig, "main.ts": `console.log(1 + 1);\n` });
  const { said, exitCode } = await run(String(dir), "check");
  expect(found(said, "error")).toEqual(["TS2688"]);
  expect(exitCode).toBe(1);
});
