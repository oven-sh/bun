// `import list = require("./list.json")` gives the value of the file, and a file that is a script for its project declares the modules that it names.
// The programs that build for that reason: parallel/what-tsc-accepts-a-build-accepts. Here: what tsc reports of their kin stops the build, with tsc's code.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const tsconfig = `{ "compilerOptions": { "strict": true, "module": "preserve", "moduleResolution": "bundler", "resolveJsonModule": true, "noEmit": true, "types": [] } }`;
const list = `class List<T> {\n  first?: T;\n}\n`;
const drawings = `declare module "drawings" {\n  import shapes = require("shapes");\n  export var squares: List<shapes.Square>;\n}\n`;

const stops: Record<string, { files: Record<string, string>; errors: string[] }> = {
  "a list that is required is no number": {
    files: {
      "list.json": `["a", 2]\n`,
      "main.ts": `import list = require("./list.json");\nconst count: number = list;\nconsole.log(count);\n`,
    },
    errors: ["TS2322"],
  },
  "a key that a required record lacks": {
    files: {
      "record.json": `{ "name": "n" }\n`,
      "empty.json": `{}\n`,
      "main.ts": `import record = require("./record.json");\nimport empty = require("./empty.json");\nconsole.log(record.name, record.size, empty.size);\n`,
    },
    errors: ["TS2339", "TS2339"],
  },
  "a key that an imported record lacks": {
    files: {
      "record.json": `{ "name": "n" }\n`,
      "main.ts": `import record from "./record.json";\nconsole.log(record.name, record.size);\n`,
    },
    errors: ["TS2339"],
  },
  "a script requires a module that nobody declares": {
    files: { "main.ts": `${list}${drawings}console.log(new List<number>().first);\n` },
    errors: ["TS2307"],
  },
  "a module names a module that is not there": {
    files: { "main.ts": `export {};\ndeclare module "nowhere" {\n  class Square {}\n}\nconsole.log(1);\n` },
    errors: ["TS2664"],
  },
};

const codesOf = (stderr: string) =>
  stderr
    .split("\n")
    .filter(line => line.startsWith("error:"))
    .map(line => line.split(":")[1].trim());

describe.skipIf(!!unsupported)("what tsc reports stops the build", () => {
  for (const [name, { files, errors }] of Object.entries(stops)) {
    test(name, () =>
      slot(async () => {
        using dir = tempDir("aot-data-files-and-scripts", { "tsconfig.json": tsconfig, ...files });
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, "./main.ts", "--outfile", "main"],
          String(dir),
          env,
        );
        expect({ errors: codesOf(built.stderr), exitCode: built.exitCode }).toEqual({ errors, exitCode: 1 });
      }),
    );
  }
});
