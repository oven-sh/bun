import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import dedent from "dedent";
import { bunEnv, bunExe } from "harness";
import { expect, it } from "bun:test";
import { tmpdir } from "os";

const outBase = path.join(tmpdir(), "bun-bundler-tests");
const testsRan = new Set();
const tempPathToBunDebug = Bun.which("bun-debug");

export interface BundlerTestInput {
  files: Record<string, string>;
  /** Files to be written only after the bundle is done. */
  runtimeFiles?: Record<string, string>;
  /** Defaults to the first item in `files` */
  entryPoints?: string[];
  /** Defaults to bundle */
  mode?: "bundle" | "transform" | "convertformat";
  /** Defaults to false */
  minifyIdentifiers?: boolean;
  /** Defaults to `/out.js` */
  outfile?: string;
  /** Defaults to `/out` */
  outdir?: string;
  /** Defaults to "bun" */
  platform?: string;
  /** Defaults to "esm" */
  format?: "esm" | "cjs" | "iife";
  globalName?: string;
  /**
   * Setting to true or an object will cause the file to be run with bun.
   * Options passed can customize and assert behavior about the bundle.
   */
  run?:
    | boolean
    | {
        /** Override file to run, instead of `options.absOutputFile` */
        file?: string;
        /** match exact stdout */
        stdout?: string;
        /** match exact error message, example "ReferenceError: Can't find variable: bar" */
        error?: string;
        /**
         * for extra confidence the error is correctly tested for, a regex for the line it was
         * thrown on can be passed. this should be replaced with a source map lookup when that's
         * available to us.
         */
        errorLineMatch?: RegExp;
      };

  /** Run after bundle happens but before runtime. */
  onAfterBundle?(api: BundlerTestEventAPI): void;

  /** Does nothing currently. */
  snapshot?: boolean;
}

export interface BundlerTestEventAPI {
  root: string;
  outfile: string;
  outdir: string;
}

/**
 * Call within a test to test the bundler. The `id` passed must be unique across the all test. See
 * `BundlerTestInput` for all available options.
 *
 * All bundle entry files and their output files are written to disk at:
 * `$TEMP/bun-bundler-tests/{id}`.
 * This can be used to inspect and debug bundles, as they are not deleted after runtime.
 *
 * Instead of comparing the bundle outputs against snapshots, most of our test cases just run the
 * bundle and have additional code to assert the logic is happening properly. This allows the
 * bundler to change exactly how it writes files (optimizations / variable renaming), without
 * breaking any tests- as long as the code in the end achieves the same result.
 *
 * Also, passing `BUN_BUNDLER_TEST_USE_ESBUILD=1` will bundle with `esbuild` instead, essentially
 * testing the `esbuild` CLI instead.
 */
export function expectBundled(id: string, opts: BundlerTestInput) {
  let {
    mode,
    platform,
    format,
    entryPoints,
    files,
    globalName,
    minifyIdentifiers,
    onAfterBundle,
    outdir,
    outfile,
    run,
    runtimeFiles,
    snapshot,
    ...unknownProps
  } = opts;

  if (Object.keys(unknownProps).length > 0) {
    throw new Error("expectBundled recieved unexpected options: " + Object.keys(unknownProps).join(", "));
  }

  if (testsRan.has(id)) {
    throw new Error(`expectBundled("${id}", ...) was called twice. Check your tests for bad copy+pasting.`);
  }

  const root = path.join(outBase, id.replaceAll("/", path.sep));

  mode ??= "bundle";
  platform ??= "bun";
  format ??= "esm";
  entryPoints ??= [Object.keys(files)[0]];
  if (run === true) run = {};

  const entryPaths = entryPoints.map(file => path.join(root, file));

  if (entryPaths.length !== 1 && outfile) {
    throw new Error("Test cannot specify `outfile` when more than one entry path.");
  }
  // TODO: allow this?
  if (entryPaths.length === 1 && outdir) {
    throw new Error("Test cannot specify `outdir` when more than one entry path.");
  }

  outfile = path.join(root, outfile ?? "/out.js");
  outdir = path.join(root, outdir ?? "/out");

  if (existsSync(root)) {
    rmSync(root, { recursive: true });
  }
  mkdirSync(root, { recursive: true });

  for (const [file, contents] of Object.entries(files)) {
    writeFileSync(path.join(root, file), dedent(contents));
  }

  const cmd = (
    !process.env.BUN_BUNDLER_TEST_USE_ESBUILD
      ? [
          tempPathToBunDebug,
          "bun",
          ...entryPaths,
          entryPaths.length === 1 ? `--outfile=${outfile}` : `--outdir=${outdir}`,
          `--format=${format}`,
          `--platform=${platform}`,
          minifyIdentifiers && `--minify-identifiers`,
          globalName && `--global-name=${globalName}`,
        ]
      : [
          Bun.which("esbuild"),
          mode === "bundle" && "--bundle",
          entryPaths.length === 1 ? `--outfile=${outfile}` : `--outdir=${outdir}`,
          `--format=${format}`,
          `--platform=${platform === "bun" ? "node" : format}`,
          minifyIdentifiers && `--minify-identifiers`,
          globalName && `--global-name=${globalName}`,
          ...entryPaths,
        ]
  )
    .flat()
    .filter(Boolean) as [string, ...string[]];

  const { stdout, stderr, success } = Bun.spawnSync({
    cmd,
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });

  if (!success) {
    throw new Error("Bundle Failed\n" + stdout!.toString("utf-8") + stderr!.toString("utf-8"));
  }

  if (entryPaths.length === 1) {
    if (!existsSync(outfile)) {
      throw new Error("Bundle was not written to disk: " + outfile);
    }
  } else {
    for (const file of entryPaths) {
      const fullpath = path.join(outdir, path.basename(file));
      if (!existsSync(fullpath)) {
        throw new Error("Bundle was not written to disk: " + fullpath);
      }
    }
  }

  for (const [file, contents] of Object.entries(runtimeFiles ?? {})) {
    writeFileSync(path.join(root, file), dedent(contents));
  }

  if (onAfterBundle) {
    onAfterBundle({ root, outfile, outdir });
  }

  if (run) {
    if (run.file) {
      run.file = path.join(root, run.file);
    } else if (entryPaths.length === 1) {
      run.file = outfile;
    } else {
      throw new Error("run.file is required when there is more than one entrypoint.");
    }

    const { success, stdout, stderr } = Bun.spawnSync({
      cmd: [bunExe(), run.file],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (run.error) {
      if (success) {
        throw new Error(
          "Bundle should have thrown at runtime\n" + stdout!.toString("utf-8") + "\n" + stderr!.toString("utf-8"),
        );
      }

      if (run.errorLineMatch) {
        // in order to properly analyze the error, we have to look backwards on stderr. this approach
        // most definetly can be improved but it works fine here.
        const stack = [];
        let error;
        const lines = stderr!
          .toString("utf-8")
          .split("\n")
          .filter(Boolean)
          .map(x => x.trim())
          .reverse();
        for (const line of lines) {
          if (line.startsWith("at")) {
            stack.push(line);
          } else {
            error = line;
            break;
          }
        }
        if (!error) {
          throw new Error(`Runtime failed with no error. Expecting "${run.error}"`);
        }
        expect(error).toBe(run.error);

        if (run.errorLineMatch) {
          const stackTraceLine = stack.pop()!;
          const match = /at (.*):(\d+):(\d+)$/.exec(stackTraceLine);
          if (match) {
            const line = readFileSync(match[1], "utf-8").split("\n")[+match[2] - 1];
            if (!run.errorLineMatch.test(line)) {
              throw new Error(`Source code "${line}" does not match expression ${run.errorLineMatch}`);
            }
          } else {
            throw new Error("Could not trace error.");
          }
        }
      }
    } else if (!success) {
      throw new Error("Runtime failed\n" + stdout!.toString("utf-8") + "\n" + stderr!.toString("utf-8"));
    }

    if (run.stdout !== undefined) {
      expect(stdout!.toString("utf-8").trim()).toBe(run.stdout);
    }
  }
}

/** Shorthand for it and expectBundled. See `expectBundled` for what this does.
 */
export function itBundled(id: string, opts: BundlerTestInput) {
  it(id, () => expectBundled(id, opts));
}
