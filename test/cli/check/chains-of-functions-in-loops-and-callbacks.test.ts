// The result type of each function is found from the next one's, in a loop or in an argument. A chain that takes more than the stack starts over where the
// functions between are not in the way, which nothing in a loop or an argument did: 2,000 functions with a loop took 57 G instructions and ended for want of stack.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const lines = (size: number, line: (i: number) => string) =>
  Array.from({ length: size }, (_, i) => line(i) + "\n").join("");

const check = async (program: string) => {
  using dir = tempDir("check-chains-of-functions", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty", "--all"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  expect(stdout + stderr).not.toContain("ran out of stack");
  const told = (stdout + stderr).matchAll(/^main\.ts\((\d+),\d+\): error (TS\d+)(: Type .*)?/gm);
  return [...told].map(([, line, code, type]) => `${line} ${code}${type ?? ""}`);
};

// The errors are those of TypeScript 7.0.2.
test.concurrent.each([10, 2000])("%d functions that each call the next in a loop", async size => {
  const link = (i: number) =>
    `function f${i}(k: number) { let a = []; for (let i = 0; i < k; i++) { const t = f${i + 1}(k); a = a.concat(t); } return a; }`;
  const program =
    lines(size, link) + `function f${size}(k: number) { return [k]; }\nconst z: never = f0(1);\nexport { z };\n`;
  expect(await check(program)).toEqual([
    ...Array.from({ length: size }, (_, i) => [`${i + 1} TS7034`, `${i + 1} TS7005`]).flat(),
    `${size + 2} TS2322: Type 'any[]' is not assignable to type 'never'.`,
  ]);
});

test.concurrent.each([10, 2400])("%d functions that each call the next in a callback", async size => {
  const program =
    lines(size, i => `function f${i}(x: number) { return [x].map(y => f${i + 1}(y))[0]; }`) +
    `function f${size}(x: number) { return String(x); }\nconst z: never = f0(1);\nexport { z };\n`;
  expect(await check(program)).toEqual([`${size + 2} TS2322: Type 'string' is not assignable to type 'never'.`]);
});

test.concurrent.each([10, 2400])("%d functions that each call the next behind a promise", async size => {
  const program =
    lines(size, i => `function f${i}(x: number) { return Promise.resolve(x).then(y => f${i + 1}(y)); }`) +
    `function f${size}(x: number) { return String(x); }\nconst z: never = f0(1);\nexport { z };\n`;
  expect(await check(program)).toEqual([
    `${size + 2} TS2322: Type 'Promise<string>' is not assignable to type 'never'.`,
  ]);
});

// Eight of every sixty functions call one another around. Where the stack is unwound, what is in such a ring is found in the order in which it's found otherwise.
test.concurrent.each([120, 2400])("%d functions that each call the next, with rings", async size => {
  const back = (i: number) => (i % 60 === 47 ? ` if (k === ${i}) return f${i - 7}(k);` : "");
  const link = (i: number) =>
    `function f${i}(k: number) { let a = null; for (let i = 0; i < k; i++) { const t = f${i + 1}(k); if (t) a = [t].concat([]); }${back(i)} return a; }`;
  const program =
    lines(size, link) + `function f${size}(k: number) { return k; }\nconst z: never = f0(1);\nexport { z };\n`;
  expect(await check(program)).toEqual([
    ...Array.from({ length: size }, (_, i) => i).flatMap(i =>
      i % 60 === 47 ? [`${i + 1} TS7023`] : i % 60 >= 40 && i % 60 < 47 ? [`${i + 1} TS7023`, `${i + 1} TS7022`] : [],
    ),
    expect.stringMatching(new RegExp(`^${size + 2} TS2322: Type '.*' is not assignable to type 'never'\\.$`)),
  ]);
});

// The errors of the functions in front are found where little of the stack is left, and their texts are written there.
test("the errors of a long chain name the types", async () => {
  const size = isDebug || isASAN ? 10 : 1500;
  const link = (i: number) =>
    `function f${i}(k: number) { let a = []; for (let i = 0; i < k; i++) { const t = f${i + 1}(k); a = a.concat(t); } return a; }`;
  using dir = tempDir("check-texts-of-chains", {
    "tsconfig.json": tsconfig,
    "main.ts": lines(size, link) + `function f${size}(k: number) { return [k]; }\nexport { f0 };\n`,
  });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty", "--all"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  const told = [...(stdout + stderr).matchAll(/error TS(?:7034|7005): Variable 'a' implicitly has (?:type|an) '(.*?)'/g)];
  expect(new Set(told.map(([, type]) => type))).toEqual(new Set(["any[]"]));
  expect(told).toHaveLength(2 * size);
});
