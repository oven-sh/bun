import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import fs, { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { isWindows } from "harness";

describe("bun build", () => {
  test("warnings dont return exit code 1", () => {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "build", path.join(import.meta.dir, "./fixtures/jsx-warning/index.jsx")],
      env: bunEnv,
    });
    expect(exitCode).toBe(0);
    expect(stderr.toString("utf8")).toContain(
      'warn: "key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.',
    );
  });

  test("generating a standalone binary in nested path, issue #4195", () => {
    function testCompile(outfile: string) {
      expect([
        "build",
        path.join(import.meta.dir, "./fixtures/trivial/index.js"),
        "--compile",
        "--outfile",
        outfile,
      ]).toRun();
    }
    function testExec(outfile: string) {
      const { exitCode, stderr } = Bun.spawnSync({
        cmd: [outfile],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(stderr.toString("utf8")).toBeEmpty();
      expect(exitCode).toBe(0);
    }
    const tmpdir = tmpdirSync();
    {
      const baseDir = `${tmpdir}/bun-build-outfile-${Date.now()}`;
      const outfile = path.join(baseDir, "index.exe");
      testCompile(outfile);
      testExec(outfile);
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
    {
      const baseDir = `${tmpdir}/bun-build-outfile2-${Date.now()}`;
      const outfile = path.join(baseDir, "b/u/n", "index.exe");
      testCompile(outfile);
      testExec(outfile);
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("works with utf8 bom", () => {
    const tmp = tmpdirSync();
    const src = path.join(tmp, "index.js");
    fs.writeFileSync(src, '\ufeffconsole.log("hello world");', { encoding: "utf8" });
    expect(["build", src]).toRun();
  });

  test("__dirname and __filename are printed correctly", () => {
    const tmpdir = tmpdirSync();
    const baseDir = `${tmpdir}/bun-build-dirname-filename-${Date.now()}`;
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(path.join(baseDir, "我")), { recursive: true };
    fs.writeFileSync(path.join(baseDir, "我", "我.ts"), "console.log(__dirname); console.log(__filename);");
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "build", path.join(baseDir, "我/我.ts"), "--compile", "--outfile", path.join(baseDir, "exe.exe")],
      env: bunEnv,
      cwd: baseDir,
    });
    expect(exitCode).toBe(0);

    const { stdout, stderr } = Bun.spawnSync({
      cmd: [path.join(baseDir, "exe.exe")],
    });
    expect(stdout.toString()).toContain(path.join(baseDir, "我") + "\n");
    expect(stdout.toString()).toContain(path.join(baseDir, "我", "我.ts") + "\n");
  });

  test.skipIf(!isWindows)("should be able to handle pretty path when using pnpm +  #14685", async () => {
    // this test code follows the same structure as and
    // is based on the code for testing issue 4893

    let testDir = tmpdirSync();

    // Clean up from prior runs if necessary
    rmSync(testDir, { recursive: true, force: true });

    // Create a directory with our test file
    mkdirSync(testDir, { recursive: true });

    writeFileSync(
      join(testDir, "index.ts"),
      "import chalk from \"chalk\"; export function main() { console.log(chalk.red('Hello, World!')); }",
    );
    writeFileSync(
      join(testDir, "package.json"),
      `
  {
  "dependencies": {
    "chalk": "^5.3.0"
  }
}`,
    );
    testDir = realpathSync(testDir);

    Bun.spawnSync({
      cmd: [bunExe(), "x", "pnpm@9", "i"],
      env: bunEnv,
      stderr: "pipe",
      cwd: testDir,
    });
    // bun build --entrypoints ./index.ts --outdir ./dist --target node
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "build",
        "--entrypoints",
        join(testDir, "index.ts"),
        "--outdir",
        join(testDir, "dist"),
        "--target",
        "node",
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);
  });
}, 10_000);

test.skipIf(!isWindows)("should be able to handle pretty path on windows #13897", async () => {
  // this test code follows the same structure as and
  // is based on the code for testing issue 4893

  let testDir = tmpdirSync();

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test file
  mkdirSync(testDir, { recursive: true });

  writeFileSync(
    join(testDir, "index.ts"),
    "import chalk from \"chalk\"; export function main() { console.log(chalk.red('Hello, World!')); }",
  );

  writeFileSync(join(testDir, "chalk.ts"), "function red(value){ consol.error(value); } export default { red };");
  testDir = realpathSync(testDir);

  // bun build --entrypoints ./index.ts --outdir ./dist --target node
  const buildOut = await Bun.build({
    entrypoints: [join(testDir, "index.ts")],
    outdir: join(testDir, "dist"),
    minify: true,
    sourcemap: "linked",
    plugins: [
      {
        name: "My windows plugin",
        async setup(build) {
          build.onResolve({ filter: /chalk/ }, () => ({ path: join(testDir, "chalk.ts").replaceAll("/", "\\") }));
        },
      },
    ],
  });
  expect(buildOut?.success).toBe(true);
});
