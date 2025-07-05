import { describe, expect, test } from "bun:test";
import { itBundled } from "./expectBundled";
import { bunEnv, bunExe, DirectoryTree, isASAN, isDebug, tempDirWithFiles } from "harness";
import { build } from "bun";

async function doesNotLeak(tempdir: string, expectedError: string) {
  const { exitCode, stdout, stderr } = await Bun.$`${bunExe()} build.ts`
    .env({ ...bunEnv })
    .cwd(tempdir)
    .quiet()
    .nothrow();

  console.log("STDOUT:\n", stdout.toString());
  console.error("STDERR:\n", stderr.toString());
  // these tests should fail
  expect(exitCode).toBe(1);
  expect(stderr.toString()).not.toContain("leak");
  expect(stderr.toString()).toContain(expectedError);
}

async function runTest(
  testKinds: Array<"in-memory" | "disk">,
  testname: string,
  basename: string,
  filesOrAbsolutePathToCopyFolderFrom: DirectoryTree,
  buildOptions: Bun.BuildConfig,
  expectedError: string,
) {
  for (const kind of testKinds) {
    test(`${kind}: ${testname}`, async () => {
      const options = { ...buildOptions, outdir: kind === "disk" ? buildOptions.outdir : undefined };
      const tempdir = tempDirWithFiles(`${basename}-${kind}`, {
        ...filesOrAbsolutePathToCopyFolderFrom,
        "build.ts": /* ts */ `
        const output = await Bun.build(${JSON.stringify(options)});
        console.log(output);
        `,
      });

      await doesNotLeak(tempdir, expectedError);
    });
  }
}

// Only run if AllocationScope is enabled
describe.if(isDebug || isASAN)("bundler", () => {
  describe("should not leak memory in error codepaths", () => {
    runTest(
      ["disk"],
      "output directory is a file",
      "output-directory-is-a-file",
      {
        "index.ts": `console.log('ooga booga!')`,
        "output": "lol!",
      },
      {
        entrypoints: ["./index.ts"],
        outdir: "./output",
        target: "bun",
        format: "esm",
        sourcemap: "external",
      },
      'Failed to create output directory "./output" is a file. Please choose a different outdir or delete "./output"',
    );

    runTest(
      ["disk"],
      "trying to write a chunk but a folder exists with same name",
      "chunk-folder-exists",
      {
        "index.ts": `console.log('ooga booga!')`,
        "dist/index.js": {
          "hi": "hi",
        },
      },
      {
        entrypoints: ["./index.ts"],
        outdir: "./dist",
        target: "bun",
        format: "esm",
        sourcemap: "external",
      },
      'Is a directory: writing chunk "./index.js"',
    );

    runTest(
      ["disk"],
      "trying to write a sourcemap but a folder exists with same name",
      "sourcemap-folder-exists",
      {
        "index.ts": `console.log('ooga booga!')`,
        "dist/index.js.map": {},
      },
      {
        entrypoints: ["./index.ts"],
        outdir: "./dist",
        target: "bun",
        format: "esm",
        sourcemap: "external",
      },
      'Is a directory: writing sourcemap for chunk "./index.js"',
    );

    runTest(
      ["disk"],
      "trying to write a bytecode file but a folder exists with same name",
      "bytecode-folder-exists",
      {
        "index.ts": `console.log('ooga booga!')`,
        "dist/index.js.jsc": {},
      },
      {
        entrypoints: ["./index.ts"],
        outdir: "./dist",
        target: "bun",
        format: "cjs",
        sourcemap: "external",
        bytecode: true,
      },
      "EISDIR: ./index.js.jsc: Is a directory",
    );
  });
});
