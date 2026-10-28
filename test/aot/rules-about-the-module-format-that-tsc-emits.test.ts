import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, said: stdout + stderr, exitCode };
}

const errors = (said: string) => [...new Set([...said.matchAll(/\berror:? (TS\d+)/g)].map(match => match[1]))].sort();

const bundler = (module: string) => ({ module, moduleResolution: "bundler", resolveJsonModule: true });
const node16 = { module: "Node16", moduleResolution: "Node16" };
const nodeNext = { module: "NodeNext", moduleResolution: "NodeNext", resolveJsonModule: true };
const other = { "other.ts": `export const one = 1;\n` };
const otherModule = { "other.mts": `export const one = 1;\nexport type One = number;\n` };
const data = { "data.json": `{ "one": 1 }\n` };

const asModule = { "package.json": JSON.stringify({ name: "module-format-rules", type: "module" }) };

const cases: [string[], object, Record<string, string>, string][] = [
  [["TS1343"], bundler("CommonJS"), { "main.ts": `console.log(typeof import.meta.url);\n` }, "string\n"],
  [
    ["TS1378"],
    bundler("ES2020"),
    { "main.ts": `const one = await Promise.resolve(1);\nconsole.log(one);\nexport {};\n` },
    "1\n",
  ],
  [["TS1432"], bundler("ES2020"), { "main.ts": `for await (const one of [1]) console.log(one);\nexport {};\n` }, "1\n"],
  [
    ["TS2854"],
    bundler("ES2020"),
    {
      "main.ts": `await using held = { async [Symbol.asyncDispose]() { console.log("disposed"); } };\nconsole.log(typeof held);\nexport {};\n`,
    },
    "object\ndisposed\n",
  ],
  [
    ["TS1323"],
    bundler("ES2015"),
    { ...other, "main.ts": `import("./other").then(other => console.log(other.one));\n` },
    "1\n",
  ],
  [
    ["TS1324"],
    bundler("ES2020"),
    {
      ...data,
      "main.ts": `import("./data.json", { with: { type: "json" } }).then(data => console.log(data.default.one));\n`,
    },
    "1\n",
  ],
  [
    ["TS2823"],
    bundler("ES2020"),
    { ...data, "main.ts": `import data from "./data.json" with { type: "json" };\nconsole.log(data.one);\n` },
    "1\n",
  ],
  [["TS1470"], node16, { "main.ts": `console.log(typeof import.meta.url);\n` }, "string\n"],
  [["TS1309"], node16, { "main.ts": `const one = await Promise.resolve(1);\nconsole.log(one);\nexport {};\n` }, "1\n"],
  [["TS1479"], node16, { ...otherModule, "main.ts": `import { one } from "./other.mjs";\nconsole.log(one);\n` }, "1\n"],
  [
    ["TS1471"],
    node16,
    { ...otherModule, "main.ts": `import other = require("./other.mjs");\nconsole.log(other.one);\n` },
    "1\n",
  ],
  [
    ["TS1541"],
    node16,
    { ...otherModule, "main.ts": `import type { One } from "./other.mjs";\nconst one: One = 1;\nconsole.log(one);\n` },
    "1\n",
  ],
  [
    ["TS1543"],
    nodeNext,
    { ...asModule, ...data, "main.ts": `import data from "./data.json";\nconsole.log(data.one);\n` },
    "1\n",
  ],
  [
    ["TS1544"],
    nodeNext,
    {
      ...asModule,
      ...data,
      "main.ts": `import { one } from "./data.json" with { type: "json" };\nconsole.log(one);\n`,
    },
    "1\n",
  ],
];

test.each(cases)(
  "%j is a rule about the module format that tsc emits: --aot compiles what Bun runs",
  async (codes, options, files, printed) => {
    using dir = tempDir("module-format-rules", {
      "package.json": JSON.stringify({ name: "module-format-rules" }),
      ...files,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", lib: ["ESNext"], noEmit: true, types: [], strict: true, ...options },
      }),
    });
    const cwd = String(dir);
    const [plain, reported, checked, built] = await Promise.all([
      run(cwd, [bunExe(), "run", "main.ts"]),
      run(cwd, [bunExe(), "check", "main.ts"]),
      run(cwd, [bunExe(), "check", "--aot", "main.ts"]),
      run(cwd, [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "program"]),
    ]);
    expect(plain.stdout).toBe(printed);
    expect(errors(reported.said).filter(code => codes.includes(code))).toEqual(codes);
    expect({ errors: errors(checked.said), exitCode: checked.exitCode }).toEqual({ errors: [], exitCode: 0 });
    expect({ errors: errors(built.said), exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
    expect((await run(cwd, [`${cwd}/program`])).stdout).toBe(printed);
  },
  180_000,
);

test.each(cases)(
  "beside %j the rest of the file is still type checked",
  async (_, options, files) => {
    using dir = tempDir("module-format-rules", {
      "package.json": JSON.stringify({ name: "module-format-rules" }),
      ...files,
      "main.ts": `${files["main.ts"]}const wrong: number = "text";\nconsole.log(wrong);\n`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", lib: ["ESNext"], noEmit: true, types: [], strict: true, ...options },
      }),
    });
    const checked = await run(String(dir), [bunExe(), "check", "--aot", "main.ts"]);
    expect({ errors: errors(checked.said), exitCode: checked.exitCode }).toEqual({ errors: ["TS2322"], exitCode: 1 });
  },
  60_000,
);

test("verbatimModuleSyntax is asked for by name: what it forbids in a CommonJS file is still reported", async () => {
  using dir = tempDir("module-format-rules", {
    ...other,
    "package.json": JSON.stringify({ name: "module-format-rules" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ESNext"],
        noEmit: true,
        types: [],
        strict: true,
        ...node16,
        verbatimModuleSyntax: true,
      },
    }),
    "main.ts": `import { one } from "./other.js";\nexport const two = one + 1;\nconsole.log(two);\n`,
  });
  const checked = await run(String(dir), [bunExe(), "check", "--aot", "main.ts"]);
  expect(errors(checked.said)).toEqual(["TS1287", "TS1295"]);
  expect(checked.exitCode).toBe(1);
});

test("a type error beside such a rule is still reported", async () => {
  using dir = tempDir("module-format-rules", {
    "package.json": JSON.stringify({ name: "module-format-rules" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ESNext"],
        noEmit: true,
        types: [],
        strict: true,
        ...bundler("CommonJS"),
      },
    }),
    "main.ts": `const kind: number = typeof import.meta.url;\nconsole.log(kind);\n`,
  });
  const checked = await run(String(dir), [bunExe(), "check", "--aot", "main.ts"]);
  expect(errors(checked.said)).toEqual(["TS2322"]);
  expect(checked.exitCode).toBe(1);
});
