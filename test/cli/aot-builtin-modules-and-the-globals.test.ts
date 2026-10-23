import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { slot } from "../aot/run-programs";
import { test } from "../aot/supported";
import { importingByName } from "./aot-builtin-modules";

const plain = "plain.mjs";

const withoutADoor: Record<string, string> = {
  [plain]: `console.log("run");`,
  "takes-process-apart.mjs": `const { env, argv } = process;\nconsole.log(env && argv ? "run" : "");`,
  "takes-process-apart-under-other-names.mjs": `const { env: variables, platform = "none" } = process;\nconsole.log(variables && platform ? "run" : "");`,
  "tests-process.mjs": `console.log(typeof process !== "undefined" && process && process.env ? "run" : "");`,
  "compares-process-with-null.mjs": `if (process != null) console.log("run");`,
  "tests-the-global-object.mjs": `console.log(typeof globalThis !== "undefined" && globalThis && globalThis.Array ? "run" : "");`,
};

const loads = `const name = ["node:zlib"][0];\n`;
const withADoor = importingByName("node:zlib", {
  "takes-the-rest-of-process.mjs": `${loads}const { env, ...rest } = process;\nconsole.log(env && typeof rest.getBuiltinModule(name).gzipSync === "function" ? "run" : "");`,
  "takes-the-loader-out-of-process.mjs": `${loads}const { getBuiltinModule } = process;\nconsole.log(typeof getBuiltinModule(name).gzipSync === "function" ? "run" : "");`,
  "takes-process-apart-by-a-computed-name.mjs": `${loads}const { ["get" + "BuiltinModule"]: load } = process;\nconsole.log(typeof load(name).gzipSync === "function" ? "run" : "");`,
  "keeps-process.mjs": `${loads}const kept = process || {};\nconsole.log(typeof kept.getBuiltinModule(name).gzipSync === "function" ? "run" : "");`,
  "keeps-the-global-object.mjs": `${loads}const kept = typeof globalThis !== "undefined" && globalThis;\nconsole.log(typeof kept.process.getBuiltinModule(name).gzipSync === "function" ? "run" : "");`,
});

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

test("what only reads written properties of process, or tests a global, brings no built-in module into the executable", async () => {
  const programs = { ...withoutADoor, ...withADoor };
  using dir = tempDir("builtin-modules-and-the-globals", programs);
  const sizes: Record<string, number> = {};
  await Promise.all(
    Object.keys(programs).map(entry =>
      slot(async () => {
        const outfile = join(String(dir), entry + ".exe");
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", "--aot", entry, "--outfile", outfile],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
        expect({ entry, stderr, exitCode }).toEqual({
          entry,
          stderr: expect.not.stringContaining("error"),
          exitCode: 0,
        });
        await using proc = Bun.spawn({ cmd: [outfile], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
        const [stdout, ranWith] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect({ entry, stdout, ranWith }).toEqual({ entry, stdout: "run\n", ranWith: 0 });
        sizes[entry] = statSync(outfile).size;
      }),
    ),
  );
  for (const entry of Object.keys(withoutADoor)) {
    expect({ entry, grows: sizes[entry] - sizes[plain] > 64 * 1024 }).toEqual({ entry, grows: false });
  }
}, 180_000);

test("bun run --aot interprets nothing of them", async () => {
  const programs = { ...withoutADoor, ...withADoor };
  using dir = tempDir("builtin-modules-and-the-globals", programs);
  await Promise.all(
    Object.keys(programs).map(entry =>
      slot(async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "--debug-aot", entry],
          cwd: String(dir),
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect({ entry, stdout, exitCode }).toEqual({ entry, stdout: "run\n", exitCode: 0 });
      }),
    ),
  );
}, 180_000);
