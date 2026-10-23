import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, tempDirForAotBuilds } from "../bundler/compile-trim-features";
import { spawned } from "./run-programs";
import { describe, test } from "./supported";

const collation = "Intl.Collator and localeCompare";
const numbers = "Intl.NumberFormat, Intl.DurationFormat and toLocaleString on numbers and BigInts";
const dates =
  "Intl.DateTimeFormat and toLocaleString, toLocaleDateString and toLocaleTimeString on Date and Temporal objects";
const segmenter = "Intl.Segmenter";
const displayNames = "Intl.DisplayNames";
const temporal = "Temporal and Date.prototype.toTemporalInstant";
const webAssembly = "WebAssembly";
const all = [collation, numbers, dates, segmenter, displayNames, temporal, webAssembly];

const evaluatesText = `console.log(new Function(process.argv[2])());`;
const callsUnderComputedKey = `console.log(globalThis.input[process.argv[2]]());`;

async function keptOf(text: string) {
  using dir = tempDir("aot-trim-named", { "main.ts": "// @ts-nocheck\n" + text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  const lines = stderr.split("\n");
  const found = all.filter(feature => lines.some(line => line.startsWith(`aot: trim: kept ${feature} (`)));
  const removed = all.filter(feature => lines.some(line => line.startsWith(`aot: trim: removed ${feature} (`)));
  expect([...found, ...removed].sort()).toEqual([...all].sort());
  return found;
}

describe.concurrent("Intl, Temporal and WebAssembly stay only in a program that names them", () => {
  test.each([
    ["text that is evaluated", evaluatesText],
    ["a call under a computed key", callsUnderComputedKey],
    ["both", `${evaluatesText}\n${callsUnderComputedKey}`],
  ])("%s keeps none of them", async (_, text) => {
    expect(await keptOf(text)).toEqual([]);
  });

  test.each([
    ["a constructor", `new Intl.Segmenter("en");`, [segmenter]],
    [
      "a constructor read from globalThis",
      `new globalThis.Intl.DisplayNames("en", { type: "region" });`,
      [displayNames],
    ],
    ["a constructor under a constant key", `new Intl["Segmenter"]("en");`, [segmenter]],
    ["a method of a string", `process.argv[2].localeCompare("a");`, [collation]],
    ["a method of a value of any type", `globalThis.input.toLocaleDateString();`, [dates]],
    ["a method taken from a pattern", `const { toLocaleString } = 5; toLocaleString.call(5);`, [numbers]],
    ["a namespace", `Temporal.Now.instant();`, [temporal]],
    ["a member of a namespace", `WebAssembly.validate(new Uint8Array(8));`, [webAssembly]],
    [
      "every member of a namespace under a computed key",
      `Intl[process.argv[3]]();`,
      [collation, numbers, dates, segmenter, displayNames],
    ],
    [
      "a string literal that becomes part of the text",
      `new Function("return new Intl.DisplayNames(" + process.argv[3] + ")")();`,
      [displayNames],
    ],
    [
      "a string literal that becomes a key",
      `globalThis.input[["x", "localeCompare"][process.argv.length]]();`,
      [collation],
    ],
  ])("%s is kept beside text that is evaluated", async (_, text, kept) => {
    expect(await keptOf(`${evaluatesText}\n${text}`)).toEqual(kept);
  });

  test.each([
    ["a variable of the program called Intl", `const Intl = { Segmenter: class {} };\nnew Intl.Segmenter();`],
    [
      "a method of the program called toLocaleString",
      `class Money { toLocaleString() { return "1"; } }\nnew Money().toLocaleString();`,
    ],
    ["a function of node:path called normalize", `require("node:path").normalize(process.argv[2]);`],
    ["a name that is only tested", `console.log("Temporal" in globalThis, Object.hasOwn(globalThis, "Intl"));`],
    ["a name in a comment", `// new Intl.Segmenter(), Temporal, WebAssembly, localeCompare`],
    ["what console.log needs to print a value of any type", `console.log(globalThis.input);`],
  ])("%s names none of them", async (_, text) => {
    expect(await keptOf(`${evaluatesText}\n${text}`)).toEqual([]);
  });
});

const buildScript = `const [entry, outfile, trim] = process.argv.slice(2);
const result = await Bun.build({ entrypoints: [entry], compile: { outfile, aot: true, trim: JSON.parse(trim) } });
console.log(result.success ? "built" : "failed");`;

const program = `const names = () => [typeof Intl, typeof Intl.NumberFormat, typeof Temporal, typeof WebAssembly, typeof (5).toLocaleString, typeof "".localeCompare].join();
console.log(names());
try {
  console.log("answer:", new Function("value", process.argv[2])(1234.5));
} catch (error) {
  console.log("caught:", error.code, error.message);
}
console.log(names());
`;
const typesOfNames = "object,function,object,object,function,function";

describe.skipIf(!canTrim)("text from outside the program that uses what was removed", () => {
  const snippets: [code: string, whole: string, api: string, name: string][] = [
    [`return value.toLocaleString("en-US")`, "1,234.5", "toLocaleString", "intl"],
    [`return new Intl.NumberFormat("en-US").format(value)`, "1,234.5", "NumberFormat", "intl"],
    [`return "a".localeCompare("b")`, "-1", "localeCompare", "intl"],
    [`return Temporal.Duration.from({ hours: 1 }).hours`, "1", "from", "temporal"],
    [`return WebAssembly.validate(new Uint8Array(8))`, "false", "validate", "webassembly"],
  ];

  test("the names stay, the call throws, and the error says how to keep the API", async () => {
    using dir = tempDirForAotBuilds("aot-trim-named", { "build.mjs": buildScript, "main.mjs": program });
    const folder = String(dir);
    const build = (outfile: string, trim: unknown) =>
      spawned([bunExe(), "build.mjs", "./main.mjs", join(folder, outfile), JSON.stringify(trim)], folder, bunEnv);
    expect(await build("whole", false)).toMatchObject({ stdout: "built\n", exitCode: 0 });
    expect(await build("trimmed", true)).toMatchObject({ stdout: "built\n", exitCode: 0 });
    expect(await build("allowed", { allow: ["intl", "temporal", "webassembly"] })).toMatchObject({
      stdout: "built\n",
      exitCode: 0,
    });

    const found: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const [code, whole, api, name] of snippets) {
      for (const executable of ["whole", "trimmed", "allowed"]) {
        found[`${executable}: ${code}`] = (await spawned([join(folder, executable), code], folder, bunEnv)).stdout;
        const answer =
          executable === "trimmed"
            ? `caught: ERR_FEATURE_REMOVED ${api} was removed by --trim because your code never uses it. To keep it, add "${name}" to compile.trim.allow in Bun.build().`
            : `answer: ${whole}`;
        expected[`${executable}: ${code}`] = `${typesOfNames}\n${answer}\n${typesOfNames}\n`;
      }
    }
    expect(found).toEqual(expected);
  }, 600_000);
});
