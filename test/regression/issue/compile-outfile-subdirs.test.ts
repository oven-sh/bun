import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/pull/22365: `--outfile` / `compile.outfile`
// with directory components on Windows, including the PE metadata pass, which
// used to fail on relative paths. The `.`/`..` case is also what the Windows
// mkdir_recursive_at_mode in src/sys/lib.rs is written against.

async function spawn(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Runs `bun build --compile` from `cwd`, which is what a relative --outfile
// resolves against. The summary on stdout is returned with the per-run
// timings ("   [12ms]", "[1.05s]") stripped so it can be compared exactly.
async function compile(cwd: string, entrypoint: string, outfile: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await spawn(
    [bunExe(), "build", "--compile", entrypoint, "--outfile", outfile, ...flags],
    cwd,
  );
  return { stdout: stdout.replace(/^\s*\[[\d.]+m?s\]\s*/gm, ""), stderr, exitCode };
}

function run(exe: string) {
  return spawn([exe]);
}

// Reads every requested VersionInfo field with a single PowerShell invocation;
// each PowerShell start costs a good fraction of a second.
async function readVersionInfo(exe: string, fields: string[]): Promise<Record<string, string | null>> {
  const { stdout, stderr, exitCode } = await spawn([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
      `(Get-Item -LiteralPath '${exe.replaceAll("'", "''")}').VersionInfo | ` +
      `Select-Object ${fields.join(",")} | ConvertTo-Json -Compress`,
  ]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
}

// Every successful compile below copies the whole bun executable, so the CLI
// cases run concurrently, each in its own temp dir.
describe.skipIf(!isWindows).concurrent("compile --outfile with subdirectories", () => {
  test.each([
    { outfile: "subdir/nested/app.exe", expected: ["subdir", "nested", "app.exe"] },
    { outfile: "subdir\\nested\\app.exe", expected: ["subdir", "nested", "app.exe"] },
    { outfile: "a/b/c/d/e/app.exe", expected: ["a", "b", "c", "d", "e", "app.exe"] },
    { outfile: "./output/../output/./app.exe", expected: ["output", "app.exe"] },
  ])("--outfile $outfile creates the directories and places the executable there", async ({ outfile, expected }) => {
    using dir = tempDir("compile-outfile-subdir", {
      // The executable prints the --outfile it was compiled with, so running it
      // proves the file at the expected path is the one this case built.
      "src/app.js": `console.log(${JSON.stringify(outfile)});`,
    });

    expect(await compile(String(dir), join(String(dir), "src", "app.js"), outfile)).toEqual({
      stdout: `bundle  1 modules\ncompile  ${outfile}\n`,
      stderr: "",
      exitCode: 0,
    });

    // Only the requested top-level directory appeared next to src/: nothing
    // else (such as the temporary copy of the executable) was left in the cwd.
    expect(readdirSync(String(dir)).sort()).toEqual([expected[0], "src"].sort());
    expect(await run(join(String(dir), ...expected))).toEqual({ stdout: `${outfile}\n`, stderr: "", exitCode: 0 });
  });

  test("Windows metadata works with subdirectories", async () => {
    using dir = tempDir("compile-metadata-subdir", {
      "app.js": `console.log("App with metadata!");`,
    });

    expect(
      await compile(
        String(dir),
        join(String(dir), "app.js"),
        "output/bin/app.exe",
        "--windows-title",
        "Subdirectory App",
        "--windows-version",
        "1.2.3.4",
        "--windows-description",
        "App in a subdirectory",
      ),
    ).toEqual({
      stdout: "bundle  1 modules\ncompile  output/bin/app.exe\n",
      stderr: "",
      exitCode: 0,
    });

    // The metadata is written into the executable after it has been moved to
    // the relative outfile, so check both that it landed and that it still runs.
    const exe = join(String(dir), "output", "bin", "app.exe");
    expect(await run(exe)).toEqual({ stdout: "App with metadata!\n", stderr: "", exitCode: 0 });
    expect(await readVersionInfo(exe, ["ProductName", "FileDescription", "ProductVersion"])).toEqual({
      ProductName: "Subdirectory App",
      FileDescription: "App in a subdirectory",
      ProductVersion: "1.2.3.4",
    });
  });

  test("fails gracefully when parent is a file", async () => {
    using dir = tempDir("compile-parent-is-file", {
      "app.js": `console.log("Won't compile!");`,
      "blocked": "This is a file, not a directory",
    });

    expect(await compile(String(dir), join(String(dir), "app.js"), "blocked/app.exe")).toEqual({
      stdout: "",
      stderr: 'ENOTDIR: Not a directory: could not open output directory "blocked" (open)\n',
      exitCode: 1,
    });
    // The build fails before the executable is copied, so nothing was written.
    expect(readdirSync(String(dir)).sort()).toEqual(["app.js", "blocked"]);
  });
});

// Bun.build() does the compile step synchronously on this thread. Run inside
// the concurrent group above, each of these multi-second blocks would count
// against every other test's timeout, so these two stay serial.
describe.skipIf(!isWindows).serial("Bun.build() compile with subdirectories", () => {
  test("places executable in subdirectory via API", async () => {
    using dir = tempDir("api-compile-subdir", {
      "app.js": `console.log("API subdirectory test!");`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      outdir: String(dir),
      compile: {
        outfile: "dist/bin/app.exe",
      },
    });

    const exe = join(String(dir), "dist", "bin", "app.exe");
    expect(result.success).toBe(true);
    expect(result.outputs.map(output => output.path)).toEqual([exe]);
    expect(await run(exe)).toEqual({ stdout: "API subdirectory test!\n", stderr: "", exitCode: 0 });
  });

  test("API with Windows metadata and subdirectories", async () => {
    using dir = tempDir("api-metadata-subdir", {
      "app.js": `console.log("API with metadata!");`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      outdir: String(dir),
      compile: {
        outfile: "build/release/app.exe",
        windows: {
          title: "API Subdirectory App",
          version: "2.0.0.0",
          publisher: "Test Publisher",
        },
      },
    });

    const exe = join(String(dir), "build", "release", "app.exe");
    expect(result.success).toBe(true);
    expect(result.outputs.map(output => output.path)).toEqual([exe]);
    expect(await run(exe)).toEqual({ stdout: "API with metadata!\n", stderr: "", exitCode: 0 });
    expect(await readVersionInfo(exe, ["ProductName", "CompanyName", "ProductVersion"])).toEqual({
      ProductName: "API Subdirectory App",
      CompanyName: "Test Publisher",
      ProductVersion: "2.0.0.0",
    });
  });
});
