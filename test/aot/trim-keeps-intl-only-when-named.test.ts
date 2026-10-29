import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, tempDirForAotBuilds } from "../bundler/compile-trim-features";
import { spawned } from "./harness/commands";
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
  const namesNone = [
    ["a call under a computed key", callsUnderComputedKey],
    ["a variable of the program called Intl", `const Intl = { Segmenter: class {} };\nnew Intl.Segmenter();`],
    [
      "a method of the program called toLocaleString",
      `class Money { toLocaleString() { return "1"; } }\nnew Money().toLocaleString();`,
    ],
    ["a function of node:path called normalize", `require("node:path").normalize(process.argv[2]);`],
    ["a name that is only tested", `console.log("Temporal" in globalThis, Object.hasOwn(globalThis, "Intl"));`],
    ["a name in a comment", `// new Intl.Segmenter(), Temporal, WebAssembly, localeCompare`],
    ["what console.log needs to print a value of any type", `console.log(globalThis.input);`],
    // Such a list is a list of keys. A class is read under its key from its namespace, and `Intl[key]` keeps all of Intl.
    [
      "a list of words that are the names of classes and namespaces",
      `for (const word of ["Collator", "NumberFormat", "DateTimeFormat", "Segmenter", "DisplayNames", "Temporal", "WebAssembly"]) console.log(word in globalThis.input);`,
    ],
  ];
  test(`text that is evaluated keeps none of them, nor does ${namesNone.map(([what]) => what).join(", ")}`, async () => {
    expect(await keptOf(`${evaluatesText}\n${namesNone.map(([, text]) => `{\n${text}\n}`).join("\n")}`)).toEqual([]);
  });

  // Each line of a program names a feature that no other line of it names.
  test.each([
    [
      "a constructor, a constructor read from globalThis, a method of a string, of a value of any type and taken from a pattern, a namespace and a member of a namespace",
      [
        `new Intl.Segmenter("en");`,
        `new globalThis.Intl.DisplayNames("en", { type: "region" });`,
        `process.argv[2].localeCompare("a");`,
        `globalThis.input.toLocaleDateString();`,
        `const { toLocaleString } = 5; toLocaleString.call(5);`,
        `Temporal.Now.instant();`,
        `WebAssembly.validate(new Uint8Array(8));`,
      ],
      all,
    ],
    [
      "a constructor under a constant key, a string literal that becomes part of the text, and one that becomes a key",
      [
        `new Intl["Segmenter"]("en");`,
        `new Function("return new Intl.DisplayNames(" + process.argv[3] + ")")();`,
        `globalThis.input[["x", "localeCompare"][process.argv.length]]();`,
      ],
      [collation, segmenter, displayNames],
    ],
    [
      "every member of a namespace under a computed key",
      [`Intl[process.argv[3]]();`],
      [collation, numbers, dates, segmenter, displayNames],
    ],
  ])("%s are kept beside text that is evaluated", async (_, texts, kept) => {
    expect(await keptOf(`${evaluatesText}\n${texts.join("\n")}`)).toEqual(kept);
  });
});

// A text of the program names what it spells wherever it stands: the compiler may keep a list or an object of constants as one piece of data.
const namedByText: [text: string, feature: string][] = [
  [`new Intl.Collator()`, collation],
  [`new Intl.NumberFormat()`, numbers],
  [`new Intl.DateTimeFormat()`, dates],
  [`new Intl.Segmenter()`, segmenter],
  [`new Intl.DisplayNames()`, displayNames],
  [`Temporal.Now.instant()`, temporal],
  [`WebAssembly.validate(bytes)`, webAssembly],
];
const run = `const run = text => new Function(text)();\n`;
const placesOfText: [place: string, program: (text: string) => string][] = [
  ["by itself", text => `run(${text});`],
  ["in a constant", text => `const text = ${text};\nrun(text);`],
  ["in a list", text => `for (const text of [${text}, "1"]) run(text);`],
  ["alone in a list", text => `for (const text of [${text}]) run(text);`],
  ["in a list of a constant of the module", text => `const texts = ["1", ${text}];\nrun(texts[process.argv.length]);`],
  ["in a list marked as const", text => `const texts = ["1", ${text}] as const;\nrun(texts[process.argv.length]);`],
  ["in a frozen list", text => `const texts = Object.freeze(["1", ${text}]);\ntexts.forEach(run);`],
  ["in a list in a list", text => `for (const [label, text] of [["a", "1"], ["b", ${text}]]) run(text);`],
  ["in an object", text => `run({ a: "1", b: ${text} }[process.argv[3]]);`],
  ["in an object in a list", text => `for (const { text } of [{ text: "1" }, { text: ${text} }]) run(text);`],
  ["in a list in an object", text => `for (const text of { a: ["1"], b: [${text}] }[process.argv[3]]) run(text);`],
  [
    "in the list that makes a Map",
    text => `for (const text of new Map([["a", "1"], ["b", ${text}]]).values()) run(text);`,
  ],
  ["in the list that makes a Set", text => `new Set(["1", ${text}]).forEach(run);`],
  ["in a list that is spread", text => `[...["1", ${text}]].forEach(run);`],
  ["in a list that a function returns", text => `const texts = () => ["1", ${text}];\ntexts().forEach(run);`],
  ["as the default of a parameter", text => `function evaluate(text = ${text}) {\n  run(text);\n}\nevaluate();`],
  [
    "in the list that is the default of a parameter",
    text => `function evaluate(texts = ["1", ${text}]) {\n  texts.forEach(run);\n}\nevaluate();`,
  ],
  ["in a field", text => `class Texts {\n  text = ${text};\n}\nrun(new Texts().text);`],
  [
    "in the list of a static field",
    text => `class Texts {\n  static all = ["1", ${text}];\n}\nTexts.all.forEach(run);`,
  ],
  ["in an enum", text => `enum Texts {\n  One = "1",\n  Two = ${text},\n}\nrun(Texts[process.argv[3]]);`],
  ["in a list beside a number", text => `for (const text of [1, ${text}]) run(String(text));`],
  ["in a list that is joined", text => `run(["return", ${text}].join(" "));`],
  ["in a template literal", text => `run(\`\${process.argv[3]}; ${text.slice(1, -1)}\`);`],
  [
    "in a template literal without a hole, in a list",
    text => `for (const text of ["1", \`${text.slice(1, -1)}\`]) run(text);`,
  ],
];

describe.concurrent("a text of the program names what it spells", () => {
  // Six places to a program. Each holds the text of a feature of its own, and one feature is named by no text.
  const programs = Array.from({ length: Math.ceil(placesOfText.length / 6) }, (_, index) =>
    placesOfText.slice(6 * index, 6 * index + 6).map(([place, program], at) => {
      const [text, feature] = namedByText[(index + at) % namedByText.length];
      return { place, feature, text: `{\n${program(JSON.stringify(text))}\n}` };
    }),
  );
  test.each(programs.map(places => [places.map(({ place }) => place).join(", "), places] as const))(
    "%s",
    async (_, places) => {
      expect(await keptOf(run + places.map(({ text }) => text).join("\n"))).toEqual(
        all.filter(feature => places.some(place => place.feature === feature)),
      );
    },
  );
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
    expect(await build("trimmed", true)).toMatchObject({ stdout: "built\n", exitCode: 0 });
    expect(await build("allowed", { allow: ["intl", "temporal", "webassembly"] })).toMatchObject({
      stdout: "built\n",
      exitCode: 0,
    });

    const found: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const [code, whole, api, name] of snippets) {
      for (const executable of ["trimmed", "allowed"]) {
        found[`${executable}: ${code}`] = (await spawned([join(folder, executable), code], folder, bunEnv)).stdout;
        const answer =
          executable === "trimmed"
            ? `caught: ERR_FEATURE_REMOVED ${api} was removed by --trim because your code never uses it by name. A name known only at run time, as in object[key]() or eval(text), does not count. To keep it, add "${name}" to compile.trim.allow in Bun.build().`
            : `answer: ${whole}`;
        expected[`${executable}: ${code}`] = `${typesOfNames}\n${answer}\n${typesOfNames}\n`;
      }
    }
    expect(found).toEqual(expected);
  }, 600_000);
});
