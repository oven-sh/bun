import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../aot/harness/run";
import { test } from "../aot/supported";
import { importingByName } from "./aot-builtin-modules";

const plain = "plain.cjs";
const never = (how: string) =>
  `const load = name => ${how};\nconsole.log(process.argv.length > 100 ? load("lib") : "run");`;

const withoutADoor: Record<string, string> = {
  [plain]: `console.log("run");`,
  "a-sum-that-starts-with-a-dot.cjs": never('require("./" + name + ".cjs")'),
  "a-template-that-starts-with-a-dot.cjs": never("require(`./${name}.cjs`)"),
  "a-template-that-starts-with-a-scope.cjs": never("require(`@scope/package-${name}/addon.node`)"),
  "a-sum-that-starts-with-the-own-folder.cjs": never('require(__dirname + "/" + name + ".cjs")'),
  "a-template-that-starts-with-the-own-folder.cjs": never("require(`${__dirname}/${name}.cjs`)"),
  "joined-to-the-own-folder.cjs": `const path = require("node:path");\n${never('require(path.join(__dirname, name + ".cjs"))')}`,
  "resolved.cjs": `const path = require("path");\n${never('require(path.resolve(name + ".cjs"))')}`,
  "an-import-that-starts-with-a-dot.mjs": never('import("./" + name + ".cjs")'),
  "an-import-joined-to-the-own-folder.mjs": `import { join } from "node:path";\n${never('import(join(import.meta.dirname, name + ".cjs"))')}`,
};

const zlib = `const name = process.argv[5] ?? "zlib";\n`;
const loaded = (how: string) => `console.log(typeof ${how}.gzipSync === "function" ? "run" : "");`;
const withADoor = importingByName("node:zlib", {
  "a-sum-that-starts-with-a-scheme.cjs": `${zlib}${loaded('require("node:" + name)')}`,
  "a-sum-that-starts-with-nothing.cjs": `${zlib}${loaded('require("" + name)')}`,
  "a-template-that-starts-with-the-name.cjs": `${zlib}${loaded("require(`${name}`)")}`,
  "joined-to-a-dot.cjs": `const path = require("node:path");\n${zlib}${loaded('require(path.join("./", name))')}`,
  "joined-by-a-function-of-the-program.cjs":
    `const path = { join: (...parts) => parts[parts.length - 1], resolve: part => part };\n${zlib}${loaded("require(path.join(__dirname, name))")}\n${loaded("require(path.resolve(name))")}`.replace(
      `"run" : "");\n`,
      `"" : "");\n`,
    ),
  "a-folder-of-the-program.cjs": `${zlib}{\n  const __dirname = "";\n  ${loaded("require(__dirname + name)")}\n}`,
});

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_AOT_VERBOSE: "1" };

test("a computed name that can only be a path does not make bun run --aot compile built-in modules", async () => {
  // Each kind in a folder of its own: `require("./" + name + ".cjs")` may load every .cjs file beside it, and those with a door import node:zlib.
  using dir = tempDir("builtin-modules-and-computed-paths", withoutADoor);
  using doors = tempDir("builtin-modules-and-computed-paths", withADoor);
  const cost: Record<string, number> = {};
  for (const entry of Object.keys({ ...withoutADoor, ...withADoor })) {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "run", "--debug-aot", entry],
      String(entry in withADoor ? doors : dir),
      env,
    );
    expect({ entry, stdout: stdout.trim(), exitCode }).toEqual({ entry, stdout: "run", exitCode: 0 });
    cost[entry] = Number(/\[aot\] image: (\d+) bytes/.exec(stderr)?.[1]);
  }
  // The bytes of the image: the same from run to run, which seconds are not. The functions of the loader come with a computed path. A built-in module such as node:zlib comes on top of them.
  // How much code the loader is beside a plain program differs between processors, so the yardstick is the cheapest program that does compile the module.
  const withTheModule = Math.min(...Object.keys(withADoor).map(entry => cost[entry]!));
  for (const entry of Object.keys({ ...withoutADoor, ...withADoor })) {
    expect({
      entry,
      cost: cost[entry],
      plain: cost[plain],
      costsAsMuchAsABuiltinModule: !(cost[entry] <= 0.75 * withTheModule),
    }).toEqual({
      entry,
      cost: expect.any(Number),
      plain: expect.any(Number),
      costsAsMuchAsABuiltinModule: entry in withADoor,
    });
  }
}, 280_000);
