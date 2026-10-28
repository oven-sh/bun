import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "lib/common.js": `globalThis.runs = (globalThis.runs || 0) + 1;\nexports.name = "common";\n`,
  "lib/other.js": `exports.name = "other";\n`,
  "sum.cjs": `console.log(require(__dirname + "/lib/common.js").name, require("./lib/common.js") === require(__dirname + "/lib/common.js"), globalThis.runs);\n`,
  "sums.cjs": `console.log(require(__dirname + "/lib" + "/common.js").name, require(__dirname + "/lib/" + "other" + ".js").name);\n`,
  "template.cjs": "console.log(require(`${__dirname}/lib/common.js`).name, globalThis.runs);\n",
  "resolve.cjs": `console.log(require.resolve(__dirname + "/lib/common.js") === require.resolve("./lib/common.js"));\n`,
  "import.mjs": `console.log((await import(__dirname + "/lib/common.js")).default.name, globalThis.runs);\n`,
  "in-a-function.cjs": `function load(which) { return which ? require(__dirname + "/lib/common.js") : require(\`\${__dirname}/lib/other.js\`); }\nconsole.log(load(true).name, load(false).name);\n`,
  "declared.cjs": `function inner(__dirname) { return require(__dirname + "/common.js").name; }\nconsole.log(inner(require("node:path").join(__filename, "..", "lib")));\n`,
};

for (const flags of [[], ["--compile-in-place"]]) {
  for (const main of ["sum.cjs", "sums.cjs", "template.cjs", "resolve.cjs", "import.mjs", "in-a-function.cjs"]) {
    test(`a file named by __dirname and a literal is compiled: ${main} ${flags.join(" ")}`, async () => {
      using dir = tempDir("dirname-and-a-literal", files);
      const plain = await run([bunExe(), "run", main], String(dir));
      expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const build = await run(
        [bunExe(), "build", "--compile", "--aot", ...flags, main, "--outfile", "program"],
        String(dir),
      );
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      if (main !== "resolve.cjs") rmSync(join(String(dir), "lib"), { recursive: true });
      const ran = await run([join(String(dir), "program")], String(dir), {
        ...bunEnv,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
      });
      expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    }, 120_000);
  }
}

test("a __dirname that the program declares is no folder of the file", async () => {
  using dir = tempDir("dirname-and-a-literal", files);
  const plain = await run([bunExe(), "run", "declared.cjs"], String(dir));
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "common\n", exitCode: 0 });
  // The path is no constant, so the build says so and takes no file for it: the file is given as a further entry point.
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "declared.cjs", "lib/common.js", "--outfile", "program"],
    String(dir),
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: expect.stringContaining("TS100064"),
    exitCode: 0,
  });
  const ran = await run([join(String(dir), "program")], String(dir));
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 120_000);
