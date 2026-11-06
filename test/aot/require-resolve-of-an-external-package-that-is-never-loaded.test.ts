import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The usual probe for an optional package: `try { require.resolve("two"); present = true } catch {}`. With `--external two` the package is
// no part of the executable, so the resolver of the run time answers. A program that loads nothing from outside asked a function of Bun's own
// that the build had left out, and the probe said "absent" of a package that is there.
const files: Record<string, string> = {
  "package.json": `{ "name": "probe" }`,
  "node_modules/two/package.json": `{ "name": "two", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/two/index.js": `module.exports = 2;`,
  "main.js": `const { basename } = require("node:path");
    const probe = ask => { try { return basename(ask()); } catch (error) { return error.constructor.name + " " + error.code; } };
    console.log("there", probe(() => require.resolve("two")));
    console.log("there, as a URL", probe(() => import.meta.resolve("two")));
    console.log("absent", probe(() => require.resolve("three")));`,
};

test("require.resolve() of an external package answers in a program that loads nothing from outside", async () => {
  using dir = tempDir("aot-require-resolve-of-an-external-package", files);
  const directory = String(dir);
  const plain = await run([bunExe(), "main.js"], directory, bunEnv);
  expect(plain.stdout.split("\n").slice(0, 2)).toEqual(["there index.js", "there, as a URL index.js"]);
  const executable = join(directory, "probe");
  const flags = ["--external", "two", "--external", "three", "main.js", "--outfile", executable];
  const built = await run([bunExe(), "build", "--compile", "--aot", ...flags], directory, bunEnv);
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], directory, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 120_000);
