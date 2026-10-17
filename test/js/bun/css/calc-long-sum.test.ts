import type { Subprocess } from "bun";
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, runCommandMaxRSS, tempDir } from "harness";
import path from "node:path";

// The time, the memory and the stack that a long calc() sum takes: https://github.com/oven-sh/bun/pull/45442

// A term that does not fold, as written and as printed.
const f = "min(1px,1em)";
const F = "min(1px, 1em)";

const slow = 2_000;
// The stack of a bundler thread held 5,000 terms in a debug build and 25,698 in a release build.
const long = isDebug ? 12_000 : isASAN ? 50_000 : 200_000;

const repeat = (unit: string, count: number) => Buffer.alloc(unit.length * count, unit).toString();
/** `count` copies of `unit` with `separator` between them. */
const join = (unit: string, separator: string, count: number) => repeat(unit + separator, count - 1) + unit;

// A test that times out leaves its child running.
const children = new Set<Subprocess>();
afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
});

async function run(cmd: string[], files: Record<string, string>) {
  using dir = tempDir("css-calc-long-sum", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  children.add(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  children.delete(proc);
  return { stdout, stderr, output: await outputOf(String(dir)), exitCode, signalCode: proc.signalCode };
}

async function outputOf(dir: string) {
  const file = Bun.file(path.join(dir, "out", "a.css"));
  return (await file.exists()) ? await file.text() : "";
}

const build = (css: string, ...flags: string[]) =>
  run(["build", "a.css", "--outdir", "out", ...flags], { "a.css": css });

/** The strings are megabytes long, so a failure must not print them. */
function expectSame(
  result: { stderr: string; exitCode: number | null; signalCode: NodeJS.Signals | null },
  actual: string,
  expected: string,
) {
  const same = actual === expected;
  expect({ length: actual.length, same, stderr: same ? "" : result.stderr.slice(0, 2000) }).toEqual({
    length: expected.length,
    same: true,
    stderr: "",
  });
  expect({ exitCode: result.exitCode, signalCode: result.signalCode }).toEqual({ exitCode: 0, signalCode: null });
}

const rule = (declaration: string) => `/* a.css */\n.a {\n  ${declaration};\n}\n`;

// Time

for (const property of ["width", "outline-width"]) {
  test.concurrent(`${property}: a difference of ${slow} terms that do not fold`, async () => {
    const result = await build(`.a{${property}:calc(${join(f, " - ", slow)})}`);
    expectSame(result, result.output, rule(`${property}: calc(${F}${repeat(` + -1 * ${F}`, slow - 1)})`));
  });

  test.concurrent(`${property}: ${slow} values, each added to a sum that grows`, async () => {
    const result = await build(`.a{${property}:calc(${f}${repeat(` + 1px + ${f}`, slow)})}`);
    expectSame(result, result.output, rule(`${property}: calc(${F} + ${slow}px${repeat(` + ${F}`, slow)})`));
  });

  test.concurrent(`${property}: ${slow} sums in brackets, each added to a sum that grows`, async () => {
    const result = await build(`.a{${property}:calc(${f}${repeat(` + (${f} + 1px)`, slow)})}`);
    expectSame(result, result.output, rule(`${property}: calc(${F} + ${F} + ${slow}px${repeat(` + ${F}`, slow - 1)})`));
  });
}

// Memory

test.concurrent("a value added to a sum of 3000 terms does not clone the sum", async () => {
  using dir = tempDir("css-calc-long-sum", { "a.css": `.a{width:calc(${join(f, " + ", 3000)} + 1vw)}` });
  const result = await runCommandMaxRSS({ cmd: [bunExe(), "build", "a.css", "--outdir", "out"], cwd: String(dir) });
  expectSame(result, await outputOf(String(dir)), rule(`width: calc(${join(F, " + ", 3000)} + 1vw)`));
  // The clones took 980 MB in a release build.
  expect(result.maxRSS).toBeLessThan((isDebug || isASAN ? 1024 : 256) * 1024 * 1024);
});

// Stack

test.concurrent(`bun build: a sum of ${long} terms`, async () => {
  const result = await build(`.a{width:calc(${join(f, " + ", long)})}`);
  expectSame(result, result.output, rule(`width: calc(${join(F, " + ", long)})`));
});

test.concurrent(`Bun.build with minify: a sum of ${long} terms`, async () => {
  const result = await run(["build-fixture.ts"], {
    "a.css": `.a{width:calc(${join(f, " + ", long)})}`,
    "build-fixture.ts": `
      const result = await Bun.build({ entrypoints: ["a.css"], outdir: "out", minify: true });
      if (!result.success) throw new AggregateError(result.logs);
    `,
  });
  expectSame(result, result.output, `.a{width:calc(${join(f, " + ", long)})}\n`);
});

test.concurrent(`a <length>: a sum of ${long} terms`, async () => {
  const result = await build(`.a{outline-width:calc(${join(f, " + ", long)})}`);
  expectSame(result, result.output, rule(`outline-width: calc(${join(F, " + ", long)})`));
});

test.concurrent(`an <angle-percentage>: a sum of ${long} terms`, async () => {
  const result = await build(`.a{background:conic-gradient(red calc(${join("min(1deg,1%)", " + ", long)}), blue)}`);
  expectSame(
    result,
    result.output,
    rule(`background: conic-gradient(red calc(${join("min(1deg, 1%)", " + ", long)}), #00f)`),
  );
});

test.concurrent(`a <number>, which cannot hold a sum: a sum of ${long} terms stays as written`, async () => {
  const result = await build(`.a{flex-grow:calc(${join("min(1,2)", " + ", long)})}`, "--minify");
  expectSame(result, result.output, `.a{flex-grow:calc(${join("min(1,2)", " + ", long)})}\n`);
});

test.concurrent(`a sum of ${long} terms in brackets, subtracted`, async () => {
  const result = await build(`.a{width:calc(1vw - (${join(f, " + ", long)}))}`);
  expectSame(result, result.output, rule(`width: calc(1vw${repeat(` + -1 * ${F}`, long)})`));
});

for (const property of ["width", "outline-width"]) {
  test.concurrent(`${property}: values that cancel at the start of a sum of ${long} terms`, async () => {
    const result = await build(
      `.a{${property}:calc(1px + 1em + 1vh + ${join(f, " + ", long)} - 1px - 1em - 1vh + 1px)}`,
    );
    expectSame(result, result.output, rule(`${property}: calc(${join(F, " + ", long)} + 1px)`));
  });
}

const query = (sum: string) => `@media (min-width: calc(${sum} + .001px)) {\n  .a {\n    color: red;\n  }\n}\n`;

test.concurrent(`a media query range of ${long} terms, lowered for the default targets of bun build`, async () => {
  // The range is printed as min-width, and .001px is added to the sum while it is printed.
  const result = await build(`@media (width > calc(${join(f, " + ", long)})){.a{color:red}}`);
  expectSame(result, result.output, `/* a.css */\n${query(join(F, " + ", long))}`);
});

test.concurrent(`a media query range of ${long} terms, lowered for Safari 14`, async () => {
  const result = await run(["prefix-fixture.ts"], {
    "prefix-fixture.ts": `
      import { cssInternals } from "bun:internal-for-testing";
      const f = ${JSON.stringify(f)};
      const sum = Buffer.alloc((f.length + 3) * ${long - 1}, f + " + ").toString() + f;
      const source = "@media (width > calc(" + sum + ")){.a{color:red}}";
      process.stdout.write(cssInternals.prefixTest(source, "", { safari: 14 << 16 }));
    `,
  });
  expectSame(result, result.stdout, query(join(F, " + ", long)));
});

test.concurrent("Bun.color: a long sum in a channel, and a slow sum in atan2()", async () => {
  const result = await run(["color-fixture.ts"], {
    "color-fixture.ts": `
      const join = (unit, separator, count) =>
        Buffer.alloc((unit.length + separator.length) * (count - 1), unit + separator).toString() + unit;
      console.log(Bun.color("rgb(calc((" + join("min(1,2)", " + ", ${long}) + ") * 2) 0 0)", "css"));
      console.log(Bun.color("hsl(atan2(" + join(${JSON.stringify(f)}, " - ", ${slow}) + ", 1px) 50% 50%)", "css"));
    `,
  });
  expect(result.stdout).toBe("null\nnull\n");
  expect({ exitCode: result.exitCode, signalCode: result.signalCode }).toEqual({ exitCode: 0, signalCode: null });
});
