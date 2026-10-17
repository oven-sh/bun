import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../aot/supported";

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
const withADoor: Record<string, string> = {
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
};

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

test("a computed name that can only be a path does not make bun run --aot compile every built-in module", async () => {
  const programs = { ...withoutADoor, ...withADoor };
  using dir = tempDir("builtin-modules-and-computed-paths", programs);
  const seconds: Record<string, number> = {};
  for (const entry of Object.keys(programs)) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--debug-aot", entry],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ entry, stdout: stdout.trim(), exitCode }).toEqual({ entry, stdout: "run", exitCode: 0 });
    seconds[entry] = Number(proc.resourceUsage()!.cpuTime.total) / 1e6;
  }
  for (const entry of Object.keys(withoutADoor)) {
    expect({
      entry,
      seconds: seconds[entry],
      plain: seconds[plain],
      costsAsMuchAsADoor: seconds[entry] > 3 * seconds[plain],
    }).toEqual({
      entry,
      seconds: expect.any(Number),
      plain: expect.any(Number),
      costsAsMuchAsADoor: false,
    });
  }
}, 280_000);
