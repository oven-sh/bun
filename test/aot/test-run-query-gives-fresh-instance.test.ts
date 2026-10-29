import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "x.ts": `let count = 0;
export function next(): number { return ++count; }
export const made = {};
`,
  "only.ts": `export const value: number = 1;`,
  "user.ts": `import { next } from "./x";
export function nextOfUser(): number { return next(); }
`,
  "a.test.ts": `import { expect, test } from "bun:test";
import { made, next } from "./x";
import { nextOfUser } from "./user";
test("each query gives a fresh instance", async () => {
  const one = await import("./x.ts?fresh=1");
  const two = await import("./x.ts?fresh=2");
  const oneAgain = await import("./x.ts?fresh=1");
  expect(one.next()).toBe(1);
  expect(one.next()).toBe(2);
  expect(two.next()).toBe(1);
  expect(oneAgain).toBe(one);
  expect(one.made).not.toBe(two.made);
  expect(one.made).not.toBe(made);
});
test("the import without a query keeps its state", () => {
  expect(next()).toBe(1);
  expect(nextOfUser()).toBe(2);
});
test("a query made at run time", async () => {
  for (const n of [Date.now(), Date.now() + 1]) {
    const fresh = await import(\`./x.ts?fresh=\${n}\`);
    expect(fresh.next()).toBe(1);
  }
});
test("a query of a file that nothing else imports", async () => {
  expect((await import("./only.ts?v=1")).value).toBe(1);
});
`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags, "./a.test.ts"], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { results, exitCode };
}

test("a query on an import in a compiled test run gives a fresh instance, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query", files);
  const plain = await runTests(String(dir));
  expect(plain.results.length).toBe(4);
  expect(plain.exitCode).toBe(0);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 60_000);

test("a query through a parameter loads, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query-parameter", {
    "x.ts": `export const v = 1;`,
    "helper.ts": `export const load = (path: string) => import(path);`,
    "a.test.ts": `import { expect, test } from "bun:test";
import { load } from "./helper";
const question = "./x.ts?v=1 is what the docs say";
test("through a parameter", async () => {
  expect(question.length).toBeGreaterThan(0);
  expect((await load(import.meta.dir + "/x.ts?fresh=1")).v).toBe(1);
});
`,
  });
  const { results, exitCode } = await runTests(String(dir), "--aot");
  expect({ results, exitCode }).toEqual({ results: ["pass through a parameter"], exitCode: 0 });
}, 60_000);
