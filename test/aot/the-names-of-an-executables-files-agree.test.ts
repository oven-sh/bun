// A program compares the names of its files with one another: process.argv[1] with its own file to learn whether it is the entry point, what require.resolve answers with a
// path that it joined itself. In an executable the names are others than under `bun run`, and the comparisons have to come out the same.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const separators = `const separators = text => (text.includes("\\\\") ? (text.includes("/") ? "both" : "backslashes") : "slashes");
const attempt = answer => { try { return answer(); } catch (error) { return error.name; } };`;
const files = {
  "main.cjs": `const path = require("node:path");
${separators}
require("./other.cjs");
const other = path.join(__dirname, "other.cjs");
const frame = new Error().stack.split("\\n")[1];
console.log(JSON.stringify({
  "argv[1] is __filename": attempt(() => process.argv[1] === __filename),
  "require.main.filename is __filename": attempt(() => require.main.filename === __filename),
  "module.filename is __filename": attempt(() => module.filename === __filename),
  "module.path is __dirname": attempt(() => module.path === __dirname),
  "require.resolve answers the joined path": attempt(() => require.resolve("./other.cjs") === other),
  "require takes the joined path": attempt(() => require(other) === require("./other.cjs")),
  "a frame names __filename": frame.includes(__filename),
  "separators": [process.argv[1], __filename, attempt(() => require.resolve("./other.cjs")), frame.slice(frame.indexOf("(") + 1)].map(separators).join(),
}, null, 1));
`,
  "other.cjs": `exports.other = true;\n`,
  "main.mjs": `import { fileURLToPath } from "node:url";
${separators}
const frame = new Error().stack.split("\\n")[1];
console.log(JSON.stringify({
  "argv[1] is the path of import.meta.url": process.argv[1] === fileURLToPath(import.meta.url),
  "argv[1] is import.meta.path": process.argv[1] === import.meta.path,
  "Bun.main is import.meta.path": Bun.main === import.meta.path,
  "import.meta.main": import.meta.main,
  "a frame names import.meta.path": frame.includes(import.meta.path),
  "separators": [process.argv[1], Bun.main, import.meta.path, frame.slice(frame.indexOf("at ") + 3)].map(separators).join(),
}, null, 1));
`,
};

test.each(["main.cjs", "main.mjs"])(
  "%s",
  async entryPoint => {
    using dir = tempDir("names-of-an-executables-files", files);
    const folder = String(dir);
    const answers = async (flags: string[] | null) => {
      const executable = join(folder, `built${flags?.length ?? ""}${isWindows ? ".exe" : ""}`);
      if (flags) {
        const built = await run(
          [bunExe(), "build", "--compile", ...flags, entryPoint, "--outfile", executable],
          folder,
        );
        expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
          stderr: "",
          exitCode: 0,
        });
      }
      const ran = await run(flags ? [executable] : [bunExe(), "run", entryPoint], folder, bunEnv);
      return ran.exitCode ? ran : ran.stdout.split("\n");
    };
    const [plain, bundled, compiled] = [await answers(null), await answers([]), await answers(["--aot"])];
    // What `bun build --compile` answers without --aot is shown beside it and not judged: there the files are one file.
    expect({ "--compile": bundled, "--compile --aot": compiled }).toEqual({
      "--compile": bundled,
      "--compile --aot": plain,
    });
  },
  240_000,
);
