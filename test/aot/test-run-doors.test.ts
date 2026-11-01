// One line in one file can make `bun test --aot` compile the whole run otherwise than an executable is compiled: after it any file may load again.
// The build names each such line: TS100079, with the file and the place. A run without one gets no such notice.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const never = (statement: string) => `if (process.argv.length > 99) { ${statement} }`;
const withRequire = `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`;

const doors: [name: string, head: string, statement: string, says: string | undefined][] = [
  ["nothing", "", "console.log(1);", undefined],
  [
    "a mock of a file that is spelled",
    `import { mock } from "bun:test";`,
    `mock.module("./other.ts", () => ({ mark: 2 }));`,
    undefined,
  ],
  ["a key that is spelled", withRequire, `delete require.cache[require.resolve("./other.ts")];`, undefined],
  ["Bun.plugin", "", `Bun.plugin({ name: "p", setup() {} });`, "This names Bun.plugin."],
  ["a file under a query", "", `await import("./other.ts?again");`, "This loads a file under a query."],
  [
    "a key that nobody spells",
    withRequire,
    `delete require.cache[process.argv[99]];`,
    "This takes a module out of the table of loaded modules under a key that the build can't tell.",
  ],
  [
    "the table handed on",
    `import Module from "node:module";`,
    `(globalThis as any).keep((Module as any)._cache);`,
    "This file hands the table of loaded modules on to code that may take anything out of it.",
  ],
];

for (const [name, head, statement, says] of doors) {
  test.concurrent(`${name}: ${says ? "the build names the line" : "no notice"}`, async () => {
    using dir = tempDir("test-run-doors", {
      "package.json": `{}`,
      "other.ts": `export const mark: number = 1;`,
      "a.test.ts": `import { test } from "bun:test";\n${head}\nimport { mark } from "./other.ts";\ntest("t", async () => { ${never(statement)} console.log("SEEN", mark); });\n`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
    const lines = stderr.split("\n");
    const notices = lines.flatMap((line, index) =>
      line.includes("TS100079")
        ? [
            [
              line.replace(/^.*TS100079: /, "").replace(/ After that any file .*$/, ""),
              lines[index + 1]
                .trim()
                .replace(/^at .*[\\/]/, "")
                .replace(/:\d+$/, ""),
            ],
          ]
        : [],
    );
    expect({ notices, seen: stdout.includes("SEEN 1"), exitCode }).toEqual({
      notices: says ? [[says, "a.test.ts:4"]] : [],
      seen: true,
      exitCode: 0,
    });
  });
}
