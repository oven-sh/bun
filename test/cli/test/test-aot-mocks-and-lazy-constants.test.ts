import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { run } from "../../aot/harness/run";
import { test } from "../../aot/supported";

setDefaultTimeout(60_000);

async function linesSeen(cwd: string, aot: boolean) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...(aot ? ["--aot"] : []), "./main.test.ts"], cwd);
  return {
    seen: stdout.split("\n").filter(line => line.startsWith("see:")),
    passed: stderr.includes(" 1 pass"),
    exitCode,
  };
}

const real = `
  export const KEY: string = "real";
  export const X = { a: 1 };
  export function helper(): string { return "real"; }
  export class Real { name(): string { return "real"; } }
`;
const mocked = `({ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } } })`;

const constants: Record<string, [declaration: string, read: string]> = {
  "an object literal that holds an imported function": [`export const made = { run: helper };`, `made.run()`],
  "an object literal that holds an imported object": [`export const made = { x: X };`, `made.x.a`],
  "an object literal that holds an imported string": [`export const made = { key: KEY };`, `made.key`],
  "an array literal that holds an imported class": [`export const made = [Real];`, `new made[0]().name()`],
  "a Map keyed by an imported string": [
    `export const made = new Map<string, number>([[KEY, 1]]);`,
    `[...made.keys()].join()`,
  ],
  "a frozen object literal": [`export const made = Object.freeze({ key: KEY });`, `made.key`],
  "what a function makes of an imported string": [
    `function wrap(key: string) { return { key }; }\nexport const made = wrap(KEY);`,
    `made.key`,
  ],
  "a constant that only a function reads": [
    `const hidden = { key: KEY };\nexport const made = { read(): string { return hidden.key; } };`,
    `made.read()`,
  ],
};

for (const [name, [declaration, read]] of Object.entries(constants)) {
  test.concurrent(`${name} is made before a mock that is installed after the import`, async () => {
    const files = {
      "real.ts": real,
      "made.ts": `import { KEY, X, helper, Real } from "./real";\n${declaration}\n`,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { made } from "./made";
        test("the constant", () => {
          mock.module("./real", () => ${mocked});
          console.log("see:", ${read});
        });
      `,
    };
    using expectedDir = tempDir("test-aot-lazy", files);
    using actualDir = tempDir("test-aot-lazy", files);
    const [expected, actual] = await Promise.all([
      linesSeen(String(expectedDir), false),
      linesSeen(String(actualDir), true),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.seen).toHaveLength(1);
    expect(actual.seen[0]).not.toContain("mocked");
    expect(actual.passed).toBe(true);
  });

  test.concurrent(`${name} is made after a mock that is installed before the import`, async () => {
    const files = {
      "real.ts": real,
      "made.ts": `import { KEY, X, helper, Real } from "./real";\n${declaration}\n`,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        mock.module("./real", () => ${mocked});
        const { made } = await import("./made");
        test("the constant", () => {
          console.log("see:", ${read});
        });
      `,
    };
    using expectedDir = tempDir("test-aot-lazy", files);
    using actualDir = tempDir("test-aot-lazy", files);
    const [expected, actual] = await Promise.all([
      linesSeen(String(expectedDir), false),
      linesSeen(String(actualDir), true),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.seen).toHaveLength(1);
    expect(actual.passed).toBe(true);
  });
}

test.concurrent("a table of functions is made before a spy on one of them", async () => {
  const files = {
    "real.ts": real,
    "made.ts": `import { helper } from "./real";\nexport const table = { run: helper };\n`,
    "main.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as real from "./real";
      import { table } from "./made";
      test("the table", () => {
        const spy = spyOn(real, "helper").mockImplementation(() => "spied");
        console.log("see:", table.run(), real.helper(), spy.mock.calls.length);
      });
    `,
  };
  using expectedDir = tempDir("test-aot-lazy", files);
  using actualDir = tempDir("test-aot-lazy", files);
  const [expected, actual] = await Promise.all([
    linesSeen(String(expectedDir), false),
    linesSeen(String(actualDir), true),
  ]);
  expect(actual).toEqual(expected);
  expect(actual.seen).toEqual(["see: real spied 1"]);
});

test.concurrent("two constants of one module are made at one time", async () => {
  const files = {
    "real.ts": real,
    "made.ts": `import { KEY } from "./real";\nexport const first = { key: KEY };\nexport const second = { key: KEY };\n`,
    "main.test.ts": `
      import { mock, test } from "bun:test";
      import { first, second } from "./made";
      test("both", () => {
        mock.module("./real", () => ({ KEY: "one" }));
        const one = first.key;
        mock.module("./real", () => ({ KEY: "two" }));
        console.log("see:", one, second.key);
      });
    `,
  };
  using expectedDir = tempDir("test-aot-lazy", files);
  using actualDir = tempDir("test-aot-lazy", files);
  const [expected, actual] = await Promise.all([
    linesSeen(String(expectedDir), false),
    linesSeen(String(actualDir), true),
  ]);
  expect(actual).toEqual(expected);
  expect(actual.seen).toEqual(["see: real real"]);
});
