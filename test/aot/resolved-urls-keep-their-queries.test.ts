import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const program = `const last = url => url.split("/").pop();
const { name } = await import("#dock?q");
console.log(name, last(import.meta.resolve("#dock?q")));
`;
const builds = {
  "with --obfuscate": { entry: "main.mjs", flags: ["--obfuscate"] },
  "for a file above the entry's folder": { entry: "sub/main.mjs", flags: [] },
};

for (const [build, { entry, flags }] of Object.entries(builds)) {
  test.concurrent(`import.meta.resolve keeps a query ${build}`, async () => {
    using dir = tempDir("aot-resolved-url-query", {
      "package.json": `{ "name": "harbor", "imports": { "#dock": "./dock.mjs" } }`,
      "dock.mjs": `export const name = "dock";\n`,
      [entry]: program,
    });
    const cwd = join(String(dir), entry, "..");
    const executable = join(cwd, isWindows ? "main.exe" : "main");
    await using built = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", ...flags, "./main.mjs", "--outfile", executable],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildErrors, buildExitCode] = await Promise.all([built.stderr.text(), built.exited]);
    expect({ buildExitCode, buildErrors }).toEqual({ buildExitCode: 0, buildErrors: expect.any(String) });
    await using ran = Bun.spawn({ cmd: [executable], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "dock dock.mjs?q\n", exitCode: 0 });
  });
}
