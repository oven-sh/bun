import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "../aot/run-programs";

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

const programs = {
  "hello.ts": `console.log("hello world");`,
  "asks.js": `
    const roads = [
      ["import", () => import("bun:internal-for-testing")],
      ["require", () => require("bun:internal-for-testing")],
      ["binding", () => require("internal/test/binding").internalBinding("icu")],
      ["getBuiltinModule", () => process.getBuiltinModule("bun:internal-for-testing")],
    ];
    for (const [road, take] of roads) {
      try {
        console.log(road, typeof (await take()));
      } catch (error) {
        console.log(road, "throws", error.message);
      }
    }
  `,
  "imports.js": `
    import { escapeRegExp } from "bun:internal-for-testing";
    console.log(escapeRegExp("a.b"));
  `,
};

const wasLeftOut =
  "Cannot load 'bun:internal-for-testing': it isn't in this executable. Import it by name somewhere in your program to keep it.";
const allowed = { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "0", BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" };
const notAllowed = { ...allowed, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: undefined };

using probe = tempDir("compile-trim-runtime-internal-for-testing-probe", { "hello.ts": programs["hello.ts"] });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--trim", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stderr: "pipe",
});

describe.skipIf(probed.exitCode !== 0 || isDebug)("bun:internal-for-testing is in no trimmed executable", () => {
  for (const [how, flags] of [
    ["--compile", []],
    ["--compile --aot", ["--aot"]],
  ] as const) {
    test.skipIf(flags.length > 0 && !!unsupported).each(["asks.js", "imports.js"])(
      `${how}: %s: it is not found, whether or not the environment allows it`,
      async entry => {
        using dir = tempDir("compile-trim-runtime-internal-for-testing", programs);
        const folder = String(dir);
        for (const [outfile, trim] of [
          ["whole", []],
          ["trimmed", ["--trim"]],
        ] as const) {
          const built = await run(
            [bunExe(), "build", "--compile", ...flags, ...trim, entry, "--outfile", outfile],
            folder,
            bunEnv,
          );
          expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
            stderr: expect.not.stringMatching(/^error\b/m),
            exitCode: 0,
          });
        }
        const whole = await run([join(folder, "whole")], folder, allowed);
        expect(whole).toEqual({ stdout: expect.not.stringContaining("throws"), stderr: "", exitCode: 0 });
        const refused = await run([join(folder, "whole")], folder, notAllowed);
        expect(refused.exitCode).toBe(entry === "asks.js" ? 0 : 1);
        expect(refused.stdout + refused.stderr).toContain(`ENOENT reading "bun:internal-for-testing"`);
        const notFound =
          entry === "asks.js"
            ? {
                stdout: `import throws ${wasLeftOut}\nrequire throws ${wasLeftOut}\nbinding throws ENOENT reading "internal/test/binding"\ngetBuiltinModule undefined\n`,
                stderr: "",
                exitCode: 0,
              }
            : {
                stdout: "",
                stderr: expect.stringContaining(`error: ${wasLeftOut}\n code: "ERR_MODULE_NOT_FOUND"\n`),
                exitCode: 1,
              };
        expect(await run([join(folder, "trimmed")], folder, allowed)).toEqual(notFound);
        expect(await run([join(folder, "trimmed")], folder, notAllowed)).toEqual(notFound);
      },
    );
  }
});
