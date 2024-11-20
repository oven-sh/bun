import { describe, expect, test } from "bun:test";
import { spawn } from "bun";
import { bunExe, tmpdirSync } from "harness";
import { join } from "path";
import { writeFile } from "fs/promises";

const testWord = "bunny";
const testString = `${testWord} ${testWord}`;

describe("bun", () => {
  test("should resolve self-imports by name", async () => {
    const tempDir = tmpdirSync();

    for (const packageName of ["pkg", "@scope/pkg"]) {
      // general check without exports
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: packageName,
        }),
      );
      await writeFile(join(tempDir, "index.js"), `module.exports.testWord = "${testWord}";`);
      await writeFile(
        join(tempDir, "other.js"),
        `const pkg = require("${packageName}");\nimport pkg2 from "${packageName}"\nconsole.log(pkg.testWord,pkg2.testWord);`,
      );

      let subprocess = spawn({
        cmd: [bunExe(), "run", "other.js"],
        cwd: tempDir,
        stdout: "pipe",
      });
      let out = await new Response(subprocess.stdout).text();
      expect(out).not.toContain(testString);

      // should not resolve not exported files
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: packageName,
          exports: { "./index.js": "./index.js" },
        }),
      );

      subprocess = spawn({
        cmd: [bunExe(), "run", "other.js"],
        cwd: tempDir,
        stdout: "pipe",
      });
      out = await new Response(subprocess.stdout).text();
      expect(out).not.toContain(testString);

      // should resolve exported files
      await writeFile(
        join(tempDir, "other.js"),
        `const pkg = require("${packageName}/index.js");\nimport pkg2 from "${packageName}/index.js"\nconsole.log(pkg.testWord,pkg2.testWord);`,
      );

      subprocess = spawn({
        cmd: [bunExe(), "run", "other.js"],
        cwd: tempDir,
        stdout: "pipe",
      });
      out = await new Response(subprocess.stdout).text();
      expect(out).toContain(testString);
    }
  });
});
