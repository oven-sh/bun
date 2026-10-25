import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { describe, eachRow, gap } from "./supported";

// Each program joins the name "Glob" from two strings, reads Bun.Glob under it and constructs the class inside a `try` block.
// --trim may keep the class or remove it. If it removes the class, `new` throws ERR_FEATURE_REMOVED, and the `catch` and `finally` blocks run.
const key = `const key = ["Gl", "ob"].join("");\n`;
const handlers = `catch (error) { console.log("caught", error.code); } finally { console.log("finally"); }\nconsole.log("end");\n`;
const skipsHandlers = "the error skips the catch and finally blocks, and the program exits with code 1";

if (!canTrim)
  console.error("SKIPPED: trim-removed-class-error-is-caught.test.ts: this build of Bun doesn't support --trim");

describe.skipIf(!canTrim)("a try block catches the error of a class that --trim removed", () => {
  eachRow([
    gap(skipsHandlers, [
      "new in the try block",
      `${key}try { console.log("made", new Bun[key]("*.js").match("a.js")); } ${handlers}`,
    ]),
    gap(skipsHandlers, [
      "new in the try block of a function",
      `${key}function make() { try { console.log("made", new Bun[key]("*.js").match("a.js")); } ${handlers} }\nmake();\n`,
    ]),
    gap(skipsHandlers, [
      "the class is read before the try block",
      `${key}const Class = Bun[key];\ntry { console.log("made", new Class("*.js").match("a.js")); } ${handlers}`,
    ]),
    [
      "Reflect.construct",
      `${key}try { console.log("made", Reflect.construct(Bun[key], ["*.js"]).match("a.js")); } ${handlers}`,
    ],
    [
      "new in a function that the try block calls",
      `${key}function make(Class) { return new Class("*.js"); }\ntry { console.log("made", make(Bun[key]).match("a.js")); } ${handlers}`,
    ],
  ] as const)(
    "%s",
    async (_, program) => {
      using dir = tempDir("aot-trim-removed-class", { "program.mjs": program });
      const folder = String(dir);
      const executable = join(folder, isWindows ? "trimmed.exe" : "trimmed");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "--trim", "program.mjs", "--outfile", executable],
        folder,
      );
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      expect(await run([executable], folder)).toEqual({
        stdout: expect.stringMatching(/^(made true|caught ERR_FEATURE_REMOVED)\nfinally\nend\n$/),
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});
