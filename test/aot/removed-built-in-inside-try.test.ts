import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, featureOf, withoutFeatures } from "../bundler/compile-trim-features";
import { unsupported } from "./run-programs";

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

(canTrim && !unsupported ? test.todo : test.skip)(
  "try/catch catches the error from a built-in that --trim-without removed, even if the compiler assumes that the built-in never throws",
  async () => {
    using dir = tempDir("removed-built-in-inside-try", {
      "program.js": `try {\n  console.log(escape("a b"));\n} catch (error) {\n  console.log("caught", error.code);\n}\n`,
    });
    const folder = String(dir);
    const build = [bunExe(), "build", "--compile", "--aot", "--trim", ...withoutFeatures([featureOf("escape")]), "program.js", "--outfile", "program"];
    expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
    expect(await run([join(folder, "program")], folder)).toEqual({ stdout: "caught ERR_FEATURE_REMOVED\n", stderr: "", exitCode: 0 });
  },
);
