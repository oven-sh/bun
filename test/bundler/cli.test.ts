import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import fs, { copyFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

  test("running a standalone binary and run its own bun (Bun.$)", () => {
    const tmp = tmpdirSync();
    const src = path.join(tmp, "index.js");
    fs.writeFileSync(src, "console.log(await Bun.$`bun --version`.text());", { encoding: "utf8" });
    const outfile = path.join(tmp, "index.exe");

    expect(["build", src, "--compile", "--outfile", outfile]).toRun();

    // this is the important one, as it should be able to have a runnable bun
    const {
      exitCode: exitCode1,
      stderr: stderr1,
      stdout: stdout1,
    } = Bun.spawnSync({
      cmd: [outfile],
      env: {
        ...bunEnv,
        PATH: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout1.toString("utf8")).toBe(`${Bun.version}\n\n`);
    expect(stderr1.toString("utf8")).toBeEmpty();
    expect(exitCode1).toBe(0);

    // ensure it prefers standalone binary bun instead of a "fake" bun in path
    const srcE = path.join(tmp, "bun.js");
    const outfileE = path.join(tmp, "bunn");
    fs.writeFileSync(srcE, "console.log('hi');", { encoding: "utf8" });
    expect(["build", srcE, "--compile", "--outfile", outfileE]).toRun();
    if (isWindows) copyFileSync(outfileE + ".exe", path.join(tmp, "bun.exe"));
    else copyFileSync(outfileE, path.join(tmp, "bun"));

    const {
      exitCode: exitCode2,
      stderr: stderr2,
      stdout: stdout2,
    } = Bun.spawnSync({
      cmd: [outfile],
      env: {
        ...bunEnv,
        PATH: tmp,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout2.toString("utf8")).toBe(`${Bun.version}\n\n`);
    expect(stderr2.toString("utf8")).toBeEmpty();
    expect(exitCode2).toBe(0);

    // bunx
    const srcX = path.join(tmp, "indexx.js");
    fs.writeFileSync(srcX, "console.log(await Bun.$`bunx cowsay hi`.text());", {
      encoding: "utf8",
    });
    const outfileX = path.join(tmp, "indexx.exe");
    expect(["build", srcX, "--compile", "--outfile", outfileX]).toRun();

    const {
      exitCode: exitCode3,
      stderr: stderr3,
      stdout: stdout3,
    } = Bun.spawnSync({
      cmd: [outfileX],
      env: {
        ...bunEnv,
        PATH: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout3.toString("utf8")).toMatchInlineSnapshot(`
      " ____
      < hi >
       ----
              \\   ^__^
               \\  (oo)\\_______
                  (__)\\       )\\/\\
                      ||----w |
                      ||     ||

      "
    `);
    expect(stderr3.toString("utf8")).toBeEmpty();
    expect(exitCode3).toBe(0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("running a standalone binary and run its own bun (child_process.fork)", () => {
    const tmp = tmpdirSync();

    const src = path.join(tmp, "index.js");
    fs.writeFileSync(
      src,
      `
        import { fork } from "child_process";
        const f = fork("-p", ["1 + 1"], { env: { BUN_DEBUG_QUIET_LOGS: "1" } });
        f.on("message", console.log);`,
      {
        encoding: "utf8",
      },
    );
    const outfile = path.join(tmp, "index.exe");

    expect(["build", src, "--compile", "--outfile", outfile]).toRun();

    // ensure no infinite loop with child_process fork
    const { exitCode, stderr, stdout } = Bun.spawnSync({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stderr.toString("utf8")).toBeEmpty();
    expect(stdout.toString("utf8")).toBe("2\n");
    expect(exitCode).toBe(0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("BUN_SKIP_STANDALONE_MODULE_GRAPH=1 to bypass running the standalone code and skip to bun cli", () => {
    const tmp = tmpdirSync();
    const src = path.join(tmp, "index.js");
    fs.writeFileSync(src, "console.log('hello world');", { encoding: "utf8" });
    const outfile = path.join(tmp, "index.exe");

    expect(["build", src, "--compile", "--outfile", outfile]).toRun();

    const {
      exitCode: exitCode1,
      stderr: stderr1,
      stdout: stdout1,
    } = Bun.spawnSync({
      cmd: [outfile, "--version"],
      env: {
        ...bunEnv,
        BUN_SKIP_STANDALONE_MODULE_GRAPH: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout1.toString("utf8")).toBe(`${Bun.version}\n`);
    expect(stderr1.toString("utf8")).toBeEmpty();
    expect(exitCode1).toBe(0);

    const {
      exitCode: exitCode2,
      stderr: stderr2,
      stdout: stdout2,
    } = Bun.spawnSync({
      cmd: [outfile, "--version"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout2.toString("utf8")).toBe("hello world\n");
    expect(stderr2.toString("utf8")).toBeEmpty();
    expect(exitCode2).toBe(0);

    fs.rmSync(tmp, { recursive: true, force: true });
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

test("you can use --outfile=... and --sourcemap", () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");
  const outFile = path.join(tmpdir, "out.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');

  const originalContent = fs.readFileSync(inputFile, "utf8");

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "build", "--outfile=" + path.relative(tmpdir, outFile), "--sourcemap", inputFile],
    env: bunEnv,
    cwd: tmpdir,
  });

  expect(exitCode).toBe(0);

  // Verify that the input file wasn't overwritten
  expect(fs.readFileSync(inputFile, "utf8")).toBe(originalContent);

  // Verify that the output file was created
  expect(fs.existsSync(outFile)).toBe(true);

  // Verify that the sourcemap file was created
  expect(fs.existsSync(outFile + ".map")).toBe(true);

  // Verify that the output file contains sourceMappingURL comment
  const outputContent = fs.readFileSync(outFile, "utf8");
  expect(outputContent).toContain("//# sourceMappingURL=out.js.map");

  expect(stdout.toString()).toMatchInlineSnapshot();
});

test("some log cases", () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");
  const outFile = path.join(tmpdir, "out.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');

  // absolute path
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "build", "--outfile=" + outFile, "--sourcemap", inputFile],
    env: bunEnv,
    cwd: tmpdir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString().replace(/in \d+ms/g, "in {time}ms")).toMatchInlineSnapshot(`
    "Bundled 1 module in {time}ms

      out.js      120 bytes  (entry point)
      out.js.map  213 bytes  (source map)

    "
  `);
});

test("log case 1", () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");
  const inputFile2 = path.join(tmpdir, "input-twooo.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');
  writeFileSync(inputFile2, 'console.log("Hello, world!");');

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "build", "--outdir=" + tmpdir + '/out', inputFile, inputFile2],
    env: bunEnv,
    cwd: tmpdir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString().replace(/in \d+ms/g, "in {time}ms")).toMatchInlineSnapshot(`
    "Bundled 2 modules in {time}ms

      input.js        42 bytes  (entry point)
      input-twooo.js  48 bytes  (entry point)

    "
  `);
});

test("log case 2", () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "build", "--outdir=" + tmpdir + '/out', inputFile],
    env: bunEnv,
    cwd: tmpdir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString().replace(/in \d+ms/g, "in {time}ms")).toMatchInlineSnapshot(`
    "Bundled 1 module in {time}ms

      input.js  42 bytes  (entry point)

    "
  `);
});
