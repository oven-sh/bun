import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// Without an outfile, the executable is named after the entrypoint and written to the working
// directory (or outdir), wherever the entrypoint lives; `Bun.build` and `bun build --compile`
// share the rule. An index.* (or bun.*) entrypoint is named after its directory, unless that name
// is taken by the directory itself, in which case the executable is named `index`. Windows
// executables get a `.exe` suffix, so there the directory name never collides.

// Every case compiles once, which reads and rewrites the whole bun binary (~1 GB under
// debug+ASAN): hence the timeout, and hence plain `describe` rather than `describe.concurrent`,
// since concurrent compiles exhaust CI memory/IO (see the note in bundler_compile.test.ts).
const TIMEOUT = 60_000;
const exe = isWindows ? ".exe" : "";

const files = {
  // Builds with the temp dir as the working directory; prints the output paths relative to it.
  "build-fixture.ts": `
    import { relative, sep } from "node:path";
    const [entrypoint, outdir] = process.argv.slice(2);
    const result = await Bun.build({ entrypoints: [entrypoint], compile: true, ...(outdir ? { outdir } : {}) });
    console.log(JSON.stringify(result.outputs.map(output => relative(process.cwd(), output.path).replaceAll(sep, "/"))));
  `,
  "index.ts": `console.log("index");`,
  "src/index.ts": `console.log("src/index");`,
  "src/bun.ts": `console.log("src/bun");`,
  "src/app.js": `console.log("src/app");`,
  "tools/mycli/index.ts": `console.log("mycli");`,
  "out/src/placeholder.txt": "",
};

function filesWritten(dir: string): string[] {
  return Array.from(new Bun.Glob("**/*").scanSync(dir))
    .map(file => file.replaceAll("\\", "/"))
    .filter(file => !(file in files));
}

describe("Bun.build({ compile: true })", () => {
  test.each([
    {
      description: "an absolute entrypoint in a subdirectory is written to the working directory",
      entrypoint: ["src", "app.js"],
      expected: `app${exe}`,
    },
    {
      description: "index.ts is named after its directory",
      entrypoint: ["tools", "mycli", "index.ts"],
      expected: `mycli${exe}`,
    },
    {
      description: "./src/index.ts, whose directory name is taken by ./src itself",
      entrypoint: "./src/index.ts",
      expected: isWindows ? "src.exe" : "index",
    },
    {
      description: "./index.ts has no directory name to use",
      entrypoint: "./index.ts",
      expected: `index${exe}`,
    },
    {
      description: "./src/index.ts with an outdir that already contains a src directory",
      entrypoint: "./src/index.ts",
      outdir: "out",
      expected: isWindows ? "out/src.exe" : "out/index",
    },
  ])(
    "$description",
    async ({ entrypoint, outdir, expected }) => {
      using dir = tempDir("compile-default-outfile", files);

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "run",
          "build-fixture.ts",
          Array.isArray(entrypoint) ? join(String(dir), ...entrypoint) : entrypoint,
          ...(outdir ? [outdir] : []),
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, stderr, exitCode, written: filesWritten(String(dir)) }).toEqual({
        stdout: JSON.stringify([expected]) + "\n",
        stderr: "",
        exitCode: 0,
        written: [expected],
      });
    },
    TIMEOUT,
  );
});

describe("bun build --compile", () => {
  test.each([
    { entrypoint: "./src/index.ts", expected: isWindows ? "src.exe" : "index" },
    { entrypoint: "./src/bun.ts", expected: isWindows ? "src.exe" : "index" },
  ])(
    "$entrypoint compiles to $expected",
    async ({ entrypoint, expected }) => {
      using dir = tempDir("compile-default-outfile-cli", files);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", entrypoint],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stderr, exitCode, written: filesWritten(String(dir)) }).toEqual({
        stderr: "",
        exitCode: 0,
        written: [expected],
      });
    },
    TIMEOUT,
  );
});
