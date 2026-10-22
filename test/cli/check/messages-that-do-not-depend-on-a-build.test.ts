// Two messages whose rule a build changes. `bun check` follows TypeScript.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function check(compilerOptions: object, text: string) {
  using dir = tempDir("check-messages-outside-a-build", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true, module: "esnext", lib: ["esnext"], types: [], ...compilerOptions }, files: ["a.ts"] }),
    "a.ts": text,
  });
  await using checked = Bun.spawn({ cmd: [bunExe(), "check"], cwd: String(dir), env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([checked.stdout.text(), checked.exited]);
  return { codes: [...stdout.matchAll(/\bTS\d+\b/g)].map(found => found[0]), exitCode };
}

const usesNull = `export const a = +null;\nexport const b = +undefined;\nexport const c = "x" in null;\n`;

test("a value that is null or undefined cannot be used, with and without strictNullChecks", async () => {
  const expected = { codes: ["TS18050", "TS18050", "TS18050"], exitCode: 1 };
  expect(await check({ strict: true, target: "esnext" }, usesNull)).toEqual(expected);
  expect(await check({ strict: false, target: "esnext" }, usesNull)).toEqual(expected);
});

const directive = `export function f(a = 10) {\n  "use strict";\n  return a;\n}\n`;

test('"use strict" in a function with a default value is an error from ES2016 on', async () => {
  expect(await check({ strict: true, target: "es2015" }, directive)).toEqual({ codes: [], exitCode: 0 });
  expect((await check({ strict: true, target: "es2016" }, directive)).codes).toEqual(expect.arrayContaining(["TS1346", "TS1347"]));
});
