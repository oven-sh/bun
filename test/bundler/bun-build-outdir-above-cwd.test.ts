import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

const files = {
  "project/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], lib: ["esnext"] } }),
  "project/index.ts": `export const one: number = 1;\n`,
  "project/nested/deeper/index.ts": `export const two: number = 2;\n`,
  "blocked": "a file\n",
};

async function build(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "build", ...args], cwd, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const filesIn = (folder: string) => readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).sort();

describe.concurrent("bun build into a folder above the working directory that does not exist yet", () => {
  const cases: [string, string, string[], string, string[]][] = [
    ["--outdir", "project", ["index.ts", "--outdir", "../made/for/@scope/name"], "made/for/@scope/name", ["index.js"]],
    ["--outdir, one folder", "project", ["index.ts", "--outdir", "../made"], "made", ["index.js"]],
    ["--outdir, two folders up", "project/nested/deeper", ["index.ts", "--outdir", "../../../made/here"], "made/here", ["index.js"]],
    ["--outdir that goes down before it goes up", "project", ["index.ts", "--outdir", "nested/../../made/here"], "made/here", ["index.js"]],
    ["--outfile", "project", ["index.ts", "--outfile", "../made/here/out.js"], "made/here", ["out.js"]],
    ["--no-bundle", "project", ["--no-bundle", "index.ts", "--outdir", "../made/here"], "made/here", ["index.js"]],
    ["--dts", "project", ["index.ts", "--dts", "--outdir", "../made/here"], "made/here", ["index.aot.ts", "index.d.ts", "index.js"]],
    ["--dts --root", "project", ["index.ts", "--dts", "--root", ".", "--outdir", "../made/here"], "made/here", ["index.aot.ts", "index.d.ts", "index.js"]],
  ];
  if (isWindows) cases.push(["--outdir with backslashes", "project", ["index.ts", "--outdir", "..\\made\\for\\it"], "made/for/it", ["index.js"]]);

  test.each(cases)("%s", async (_, cwd, args, folder, written) => {
    using dir = tempDir("build-outdir-above-cwd", files);
    const built = await build(join(String(dir), cwd), ...args);
    expect(built.stderr).toBe("");
    expect(filesIn(join(String(dir), folder))).toEqual(written);
    expect(built.exitCode).toBe(0);
  });

  test("--dts says which folder could not be made", async () => {
    using dir = tempDir("build-outdir-above-cwd", files);
    const built = await build(join(String(dir), "project"), "index.ts", "--dts", "--outdir", "../blocked/inside");
    expect(built.stderr).toContain("Failed to create output directory");
    expect(built.stderr).toContain('"../blocked/inside"');
    expect(built.exitCode).toBe(1);
  });
});
