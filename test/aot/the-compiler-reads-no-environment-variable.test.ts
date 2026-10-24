// What a build makes of a program depends on the program and on the flags of the build, not on the environment of whoever
// builds it. Goes by the text of the engine's sources. One place is let through. It belongs to the run time, has a
// test of its own (checked-native-calls-are-listed.test.ts) and is left out of a hardened build.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sources = [process.env.BUN_WEBKIT_PATH, join(import.meta.dir, "..", "..", "vendor", "WebKit")]
  .filter(path => path !== undefined)
  .map(path => join(path, "Source", "JavaScriptCore", "aot"))
  .find(path => existsSync(join(path, "ir")));
if (!sources) {
  console.error(
    "SKIPPED: test/aot/the-compiler-reads-no-environment-variable.test.ts: there is no Source/JavaScriptCore/aot in $BUN_WEBKIT_PATH or vendor/WebKit",
  );
}

const known = ["runtime/AOTNativeCallValidation.cpp"];

test.skipIf(!sources)("no file of the engine outside its tests asks for an environment variable", () => {
  let numberOfFiles = 0;
  const found: string[] = [];
  for (const file of new Bun.Glob("**/*.{h,cpp}").scanSync(sources!)) {
    const name = file.replaceAll("\\", "/");
    if (name.startsWith("tests/")) continue;
    numberOfFiles++;
    if (/\b(?:secure_)?getenv\s*\(|\benviron\b/.test(readFileSync(join(sources!, file), "utf8"))) found.push(name);
  }
  expect(numberOfFiles).toBeGreaterThan(1000);
  expect(found.sort()).toEqual(known);
});
