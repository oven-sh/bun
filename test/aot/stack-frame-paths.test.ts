// A frame of a module that is compiled into an executable names its file as `/$bunfs/root/` and the path relative to the folder
// the build ran in. Lines and columns are the sources'. Whatever reads a frame's file gets that text: Error.stack, call sites,
// error.sourceURL, console.trace and the uncaught-exception printer. An in-place executable, `bun run --aot` and `bun test --aot`
// run real files and show their real paths.
import { expect } from "bun:test";
import { readFileSync, realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, sep } from "path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"], allowJs: true },
  }),
  "app/main.ts": `
    import { viaModule } from "./src/module.mjs";
    import { viaTyped, sites } from "./src/deep/typed";
    import viaCommonJS from "./src/common.cjs";
    import viaPackage from "frames-of-a-package";
    import { above } from "../above";
    import { EventEmitter } from "node:events";
    const top = (stack: string | undefined): string => (stack ?? "").split("\\n")[1].trim();
    function own(): string { return top(new Error().stack); }
    console.log("entry point:", own());
    console.log("module:", top(viaModule()));
    console.log("typed:", top(viaTyped()));
    console.log("CommonJS:", top(viaCommonJS()));
    console.log("package:", top(viaPackage()));
    console.log("above the build's folder:", top(above()));
    console.log("call sites:", JSON.stringify(sites()));
    console.log("sourceURL:", (new Error() as Error & { sourceURL: string }).sourceURL);
    const holder: { stack?: string } = {};
    Error.captureStackTrace(holder);
    console.log("captureStackTrace:", top(holder.stack));
    console.log("top level:", top(new Error().stack));
    new EventEmitter().on("asked", () => console.log("through node:events:", (new Error().stack ?? "").split("\\n").filter(line => line.includes("emit")).map(line => line.trim().replace(/:\\d+:\\d+/, ""))[0])).emit("asked");
    await Promise.resolve();
    console.log("after an await:", top(new Error().stack));
    if (process.argv.includes("trace")) console.trace("traced");
    if (process.argv.includes("throw")) viaTyped(true);
  `,
  "app/src/module.mjs": `export function viaModule() { return new Error().stack; }\n`,
  "app/src/module.d.mts": `export function viaModule(): string;\n`,
  "app/src/deep/typed.ts": `
    export function viaTyped(throws = false): string | undefined {
      if (throws) throw new RangeError("thrown in typed.ts");
      return new Error().stack;
    }
    export function sites(): (string | number | null)[][] {
      const previous = Error.prepareStackTrace;
      Error.prepareStackTrace = (_error, sites) => sites;
      const found = new Error().stack as unknown as NodeJS.CallSite[];
      Error.prepareStackTrace = previous;
      return found.slice(0, 2).map(site => [site.getFileName(), site.getScriptNameOrSourceURL(), site.getLineNumber(), site.getColumnNumber(), site.getFunctionName()]);
    }
  `,
  "app/src/common.cjs": `module.exports = function viaCommonJS() { return new Error().stack; };\n`,
  "app/src/common.d.cts": `declare function viaCommonJS(): string;\nexport = viaCommonJS;\n`,
  "app/node_modules/frames-of-a-package/package.json": JSON.stringify({
    name: "frames-of-a-package",
    version: "1.0.0",
    main: "lib/index.js",
    types: "lib/index.d.ts",
  }),
  "app/node_modules/frames-of-a-package/lib/index.js": `module.exports = function viaPackage() { return new Error().stack; };\n`,
  "app/node_modules/frames-of-a-package/lib/index.d.ts": `declare function viaPackage(): string;\nexport = viaPackage;\n`,
  "above.ts": `export function above(): string | undefined { return new Error().stack; }\n`,
  // What packages do with the file of a frame, each in the form the package has it.
  "app/idioms.ts": `
    import { folderOfCaller, fileOfCaller, firstFileOutside, firstFrameWithASlash } from "reads-frames";
    import { viaHelper } from "./src/helper.cjs";
    console.log("the folder a lookup starts from (resolve):", folderOfCaller());
    console.log("the file two frames up (get-caller-file):", viaHelper(fileOfCaller));
    console.log("the first file that is not a loader's (caller):", viaHelper(firstFileOutside));
    console.log("the first frame that is not the package's own build (msw):", firstFrameWithASlash(new Error()));
  `,
  "app/src/helper.cjs": `exports.viaHelper = function viaHelper(ask) { return ask(); };\n`,
  "app/src/helper.d.cts": `export function viaHelper(ask: () => string | undefined): string | undefined;\n`,
  "app/node_modules/reads-frames/package.json": JSON.stringify({
    name: "reads-frames",
    version: "1.0.0",
    main: "index.js",
    types: "index.d.ts",
  }),
  "app/node_modules/reads-frames/index.d.ts": `
    export function folderOfCaller(): string;
    export function fileOfCaller(): string | undefined;
    export function firstFileOutside(): string | undefined;
    export function firstFrameWithASlash(error: Error): string | undefined;
  `,
  "app/node_modules/reads-frames/index.js": `
    const path = require("path");
    function sites() {
      const previous = Error.prepareStackTrace;
      Error.prepareStackTrace = (_, found) => found;
      const found = new Error().stack;
      Error.prepareStackTrace = previous;
      return found;
    }
    exports.folderOfCaller = function folderOfCaller() { return path.dirname(sites()[2].getFileName()); };
    exports.fileOfCaller = function fileOfCaller() { return sites()[3]?.getFileName(); };
    exports.firstFileOutside = function firstFileOutside() {
      const found = sites().slice(2);
      let file;
      do file = found.shift()?.getFileName(); while (found.length && file === "module.js");
      return file;
    };
    exports.firstFrameWithASlash = function firstFrameWithASlash(error) {
      const frame = error.stack.split("\\n").slice(1).find(frame => !/(node_modules)?[/\\\\]lib[/\\\\](core|browser|node|native|iife)[/\\\\]|^[^/\\\\]*$/.test(frame));
      return frame?.replace(/\\s*at [^()]*\\(([^)]+)\\)/, "$1").replace(/^\\s*at /, "");
    };
  `,
};

function project() {
  const dir = tempDir("stack-frame-paths", files);
  return { dir, app: join(realpathSync(String(dir)), "app"), [Symbol.dispose]: () => dir[Symbol.dispose]() };
}

// The root of the modules of an executable is B:\~BUN\root on Windows.
const root = isWindows ? "B:\\~BUN\\root" : "/$bunfs/root";
const under = (...parts: string[]) => [root, ...parts].join(sep);
const pattern = (text: string) => text.replace(/[\\$.]/g, "\\$&");

// What plain Bun prints, with the build's folder replaced by the root of the executable's own files.
const inExecutable = (text: string, app: string) =>
  text
    .replaceAll(join(app, "..", "above.ts"), () => under("_.._", "above.ts"))
    .replaceAll(app, () => root)
    .replaceAll(JSON.stringify(app).slice(1, -1), () => JSON.stringify(root).slice(1, -1));

function pathsBelow(executable: Buffer, folder: string) {
  const found: string[] = [];
  for (let at = executable.indexOf(folder); at >= 0; at = executable.indexOf(folder, at + 1))
    found.push(executable.subarray(at + folder.length, executable.indexOf(0, at)).toString());
  return found;
}

describe.concurrent("the file of a stack frame", () => {
  test("in an executable: /$bunfs/root/ and the path from the build's folder", async () => {
    using at = project();
    const plain = await spawned([bunExe(), "run", "main.ts"], at.app, bunEnv);
    expect(plain.exitCode).toBe(0);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "../program"], at.app, bunEnv),
    );
    const compiled = await spawned([join(at.app, "../program")], "/", bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: inExecutable(plain.stdout, at.app),
      exitCode: 0,
    });
    expect(compiled.stdout).toContain(`typed: at viaTyped (${under("src", "deep", "typed.ts")}:4:`);
    expect(compiled.stdout).toContain(
      `package: at viaPackage (${under("node_modules", "frames-of-a-package", "lib", "index.js")}:1:`,
    );
    // The executable holds no path of the build's folder.
    expect(pathsBelow(readFileSync(join(at.app, isWindows ? "../program.exe" : "../program")), at.app)).toEqual([]);
  }, 120_000);

  test("in an executable: what packages do with the file of a frame", async () => {
    using at = project();
    const plain = await spawned([bunExe(), "run", "idioms.ts"], at.app, bunEnv);
    expect(plain.exitCode).toBe(0);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "idioms.ts", "--outfile", "../program"], at.app, bunEnv),
    );
    const compiled = await spawned([join(at.app, "../program")], "/", bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: inExecutable(plain.stdout, at.app),
      exitCode: 0,
    });
    expect(compiled.stdout.split("\n")).toEqual([
      `the folder a lookup starts from (resolve): ${root}`,
      `the file two frames up (get-caller-file): ${under("idioms.ts")}`,
      `the first file that is not a loader's (caller): ${under("src", "helper.cjs")}`,
      expect.stringMatching(
        new RegExp(
          `^the first frame that is not the package's own build \\(msw\\): ${pattern(under("idioms.ts"))}:\\d+:\\d+$`,
        ),
      ),
      "",
    ]);
  }, 120_000);

  test("in an executable: console.trace and an uncaught exception", async () => {
    using at = project();
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "../program"], at.app, bunEnv),
    );
    const traced = await spawned([join(at.app, "../program"), "trace"], "/", bunEnv);
    expect(traced.stdout).toMatch(new RegExp(`traced\\n\\s+at ${pattern(under("main.ts"))}:\\d+:\\d+`));
    const thrown = await spawned([join(at.app, "../program"), "throw"], "/", bunEnv);
    expect(thrown.exitCode).toBe(1);
    expect(thrown.stderr).toContain("RangeError: thrown in typed.ts");
    expect(thrown.stderr).toMatch(new RegExp(`at viaTyped \\(${pattern(under("src", "deep", "typed.ts"))}:3:\\d+\\)`));
    expect(thrown.stderr).toMatch(new RegExp(`at ${pattern(under("main.ts"))}:\\d+:\\d+`));
    // An executable opens no file to show its source, also where its sources lie beside it.
    expect(thrown.stderr).not.toContain("if (throws) throw");
    const besideTheSources = await spawned([join(at.app, "../program"), "throw"], at.app, bunEnv);
    expect(besideTheSources.stderr).toBe(thrown.stderr);
  }, 120_000);

  // TODO: a minified executable prints the file's name.
  test.todo(
    "in a minified executable the path's token follows the prefix",
    async () => {
      using at = project();
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", "--minify", "main.ts", "--outfile", "../program"],
          at.app,
          bunEnv,
        ),
      );
      const compiled = await spawned([join(at.app, "../program")], "/", bunEnv);
      expect(compiled.exitCode).toBe(0);
      for (const line of compiled.stdout.split("\n").filter(line => / at /.test(line) && !line.includes("node:events")))
        expect(line).toMatch(new RegExp(`${pattern(under(""))}[A-Za-z0-9]+:\\d+:\\d+\\)?$`));
      expect(compiled.stdout).not.toContain("typed.ts");
    },
    120_000,
  );

  test.each([
    [
      "an in-place executable",
      ["build", "--compile", "--aot", "--compile-in-place", "main.ts", "--outfile", "../program"],
    ],
    ["bun run --aot", null],
    ["bun run --debug-aot", null],
  ] as const)(
    "%s shows the real path",
    async (name, build) => {
      using at = project();
      const plain = await spawned([bunExe(), "run", "main.ts"], at.app, bunEnv);
      if (build) built(await spawned([bunExe(), ...build], at.app, bunEnv));
      const ran = await spawned(
        build ? [join(at.app, "../program")] : [bunExe(), "run", name.split(" ")[2], "main.ts"],
        at.app,
        bunEnv,
      );
      expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
      expect(ran.stdout).toContain(`typed: at viaTyped (${join(at.app, "src", "deep", "typed.ts")}:4:`);
    },
    120_000,
  );
});
