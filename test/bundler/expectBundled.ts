/**
 * See `./expectBundled.md` for how this works.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import dedent from "dedent";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { callerSourceOrigin } from "bun:jsc";
import { fileURLToPath } from "bun";
import type { Expect } from "bun:test";

type BunTestExports = typeof import("bun:test");
export function testForFile(file: string): BunTestExports {
  if (file.startsWith("file://")) {
    file = fileURLToPath(new URL(file));
  }

  var testFile = testFiles.get(file);
  if (!testFile) {
    testFile = (Bun as any).jest(file);
    testFiles.set(file, testFile);
  }
  return testFile;
}

/** Use `esbuild` instead of `bun build` */
const ESBUILD = process.env.BUN_BUNDLER_TEST_USE_ESBUILD;
/** Write extra files to disk and log extra info. */
const DEBUG = process.env.BUN_BUNDLER_TEST_DEBUG;
/** Set this to the id of a bundle test to run just that test */
const FILTER = process.env.BUN_BUNDLER_TEST_FILTER;
/** Path to the bun. TODO: Once bundler is merged, we should remove the `bun-debug` fallback. */
const BUN_EXE = (process.env.BUN_EXE && Bun.which(process.env.BUN_EXE)) ?? Bun.which("bun-debug") ?? bunExe();

const outBaseTemplate = path.join(tmpdir(), "bun-build-tests", `${ESBUILD ? "esbuild" : "bun"}-`);
if (!existsSync(path.dirname(outBaseTemplate))) mkdirSync(path.dirname(outBaseTemplate), { recursive: true });
const outBase = mkdtempSync(outBaseTemplate);
const testsRan = new Set();

if (ESBUILD) {
  console.warn("NOTE: using esbuild for bun build tests");
}

export const ESBUILD_PATH = import.meta.resolveSync("esbuild/bin/esbuild");

export interface BundlerTestInput {
  // file options
  files: Record<string, string>;
  /** Files to be written only after the bundle is done. */
  runtimeFiles?: Record<string, string>;
  /** Defaults to the first item in `files` */
  entryPoints?: string[];
  /** ??? */
  entryPointsAdvanced?: Array<{ input: string; output?: string }>;
  /** These are not path resolved. Used for `default/RelativeEntryPointError` */
  entryPointsRaw?: string[];
  /** Defaults to bundle */
  mode?: "bundle" | "transform";
  /** Used for `default/ErrorMessageCrashStdinIssue2913`. */
  stdin?: { contents: string; cwd: string };
  /** Use when doing something weird with entryPoints and you need to check other output paths. */
  outputPaths?: string[];

  // bundler options
  alias?: Record<string, string>;
  assetNames?: string;
  banner?: string;
  define?: Record<string, string | number>;
  /** Default is "[name].[ext]" */
  entryNames?: string;
  extensionOrder?: string[];
  /** Replaces "{{root}}" with the file root */
  external?: string[];
  /** Defaults to "esm" */
  format?: "esm" | "cjs" | "iife";
  globalName?: string;
  ignoreDCEAnnotations?: boolean;
  inject?: string[];
  jsx?: {
    factory?: string;
    fragment?: string;
    automaticRuntime?: boolean;
    development?: boolean;
  };
  outbase?: string;
  /** Defaults to `/out.js` */
  outfile?: string;
  /** Defaults to `/out` */
  outdir?: string;
  /** Defaults to "browser". "bun" is set to "node" when using esbuild. */
  platform?: "bun" | "node" | "neutral" | "browser";
  publicPath?: string;
  keepNames?: boolean;
  legalComments?: "none" | "inline" | "eof" | "linked" | "external";
  loader?: Record<string, string>;
  mangleProps?: RegExp;
  mangleQuoted?: boolean;
  mainFields?: string[];
  metafile?: boolean | string;
  minifyIdentifiers?: boolean;
  minifySyntax?: boolean;
  targetFromAPI?: "TargetWasConfigured";
  minifyWhitespace?: boolean;
  splitting?: boolean;
  treeShaking?: boolean;
  unsupportedCSSFeatures?: string[];
  unsupportedJSFeatures?: string[];
  useDefineForClassFields?: boolean;
  sourceMap?: boolean | "inline" | "external";

  // assertion options

  /**
   * If passed, the bundle should fail with given error messages.
   *
   * Pass an object mapping filenames to an array of error strings that file should contain.
   */
  bundleErrors?: true | Record<string, string[]>;
  /**
   * Same as bundleErrors except for warnings. Bundle should still succeed.
   */
  bundleWarnings?: true | Record<string, string[]>;
  /**
   * Setting to true or an object will cause the file to be run with bun.
   * Pass an array to run multiple times with different options.
   */
  run?: boolean | BundlerTestRunOptions | BundlerTestRunOptions[];

  /**
   * Shorthand for testing dead code elimination cases.
   * Checks source code for REMOVE, FAIL, DROP, which will fail the test.
   */
  dce?: boolean;
  /**
   * Override the number of keep markers, which is auto detected by default.
   * Does nothing if dce is false.
   */
  dceKeepMarkerCount?: number | Record<string, number> | false;
  /**
   * Shorthand for testing splitting cases. Given a list of files, checks that each file doesn't
   * contain the specified strings. This lets us test that certain values are not bundled.
   */
  assertNotPresent?: Record<string, string | string[]>;

  /** Used on tests in the esbuild suite that fail and skip. */
  skipOnEsbuild?: boolean;

  /** Run after bundle happens but before runtime. */
  onAfterBundle?(api: BundlerTestBundleAPI): void;
}

export interface BundlerTestBundleAPI {
  root: string;
  outfile: string;
  outdir: string;

  readFile(file: string): string;
  writeFile(file: string, contents: string): void;
  prependFile(file: string, contents: string): void;
  appendFile(file: string, contents: string): void;
  expectFile(file: string): Expect;
  assertFileExists(file: string): void;

  warnings: Record<string, { file: string; error: string; line?: string; col?: string }[]>;
  options: BundlerTestInput;
}

export interface BundlerTestRunOptions {
  /** Override file to run, instead of `options.absOutputFile` */
  file?: string;
  /** Pass args to the program */
  args?: string[];
  /** Pass args to bun itself (before the filename) */
  bunArgs?: string[];
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

  runtime?: "bun" | "node";
}

var testFiles = new Map();

export function expectBundled(id: string, opts: BundlerTestInput, dryRun?: boolean) {
  var { expect, it, test } = testForFile(callerSourceOrigin());
  if (FILTER && id !== FILTER) return;

  let {
    assertNotPresent,
    banner,
    bundleErrors,
    bundleWarnings,
    dce,
    dceKeepMarkerCount,
    define,
    entryNames,
    entryPoints,
    entryPointsRaw,
    external,
    files,
    format,
    globalName,
    inject,
    jsx = {},
    keepNames,
    legalComments,
    loader,
    mainFields,
    metafile,
    minifyIdentifiers,
    minifySyntax,
    minifyWhitespace,
    mode,
    onAfterBundle,
    outbase,
    outdir,
    outfile,
    outputPaths,
    platform,
    run,
    runtimeFiles,
    skipOnEsbuild,
    sourceMap,
    splitting,
    treeShaking,
    unsupportedCSSFeatures,
    unsupportedJSFeatures,
    ...unknownProps
  } = opts;

  // TODO: Remove this check once all options have been implemented
  if (Object.keys(unknownProps).length > 0) {
    throw new Error("expectBundled recieved unexpected options: " + Object.keys(unknownProps).join(", "));
  }

  // This is a sanity check that protects against bad copy pasting.
  if (testsRan.has(id)) {
    throw new Error(`expectBundled("${id}", ...) was called twice. Check your tests for bad copy+pasting.`);
  }

  // Resolve defaults for options and some related things
  mode ??= "bundle";
  platform ??= "browser";
  format ??= "esm";
  entryPoints ??= entryPointsRaw ? [] : [Object.keys(files)[0]];
  if (run === true) run = {};
  if (metafile === true) metafile = "/metafile.json";
  if (bundleErrors === true) bundleErrors = {};
  if (bundleWarnings === true) bundleWarnings = {};
  const useOutFile = outfile ? true : outdir ? false : entryPoints.length === 1;

  if (!ESBUILD && format !== "esm") {
    throw new Error("formats besides esm not implemented in bun build");
  }
  if (!ESBUILD && metafile) {
    throw new Error("metafile not implemented in bun build");
  }
  if (!ESBUILD && legalComments) {
    throw new Error("legalComments not implemented in bun build");
  }
  if (!ESBUILD && unsupportedJSFeatures && unsupportedJSFeatures.length) {
    throw new Error("unsupportedJSFeatures not implemented in bun build");
  }
  if (!ESBUILD && unsupportedCSSFeatures && unsupportedCSSFeatures.length) {
    throw new Error("unsupportedCSSFeatures not implemented in bun build");
  }
  if (!ESBUILD && outbase) {
    throw new Error("outbase not implemented in bun build");
  }
  if (!ESBUILD && keepNames) {
    throw new Error("keepNames not implemented in bun build");
  }
  if (!ESBUILD && minifyIdentifiers) {
    throw new Error("minifyIdentifiers not implemented in bun build");
  }
  if (!ESBUILD && mainFields) {
    throw new Error("mainFields not implemented in bun build");
  }
  if (!ESBUILD && loader) {
    throw new Error("loader not implemented in bun build");
  }
  if (ESBUILD && skipOnEsbuild) {
    return;
  }
  if (dryRun) {
    return;
  }

  const root = path.join(outBase, id.replaceAll("/", path.sep));
  if (DEBUG) console.log("root:", root);

  const entryPaths = entryPoints.map(file => path.join(root, file));

  if (external) {
    external = external.map(x => x.replace(/\{\{root\}\}/g, root));
  }

  outfile = useOutFile ? path.join(root, outfile ?? "/out.js") : undefined;
  outdir = !useOutFile ? path.join(root, outdir ?? "/out") : undefined;
  metafile = metafile ? path.join(root, metafile) : undefined;
  outputPaths = (
    outputPaths
      ? outputPaths.map(file => path.join(root, file))
      : entryPaths.map(file => path.join(outdir!, path.basename(file)))
  ).map(x => x.replace(/\.ts$/, ".js"));

  if (outdir) {
    entryNames ??= "[name].[ext]";
  }

  // Option validation
  if (entryPaths.length !== 1 && outfile && !entryPointsRaw) {
    throw new Error("Test cannot specify `outfile` when more than one entry path.");
  }

  // Prepare source folder
  if (existsSync(root)) {
    rmSync(root, { recursive: true });
  }
  for (const [file, contents] of Object.entries(files)) {
    const filename = path.join(root, file);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, dedent(contents).replace(/\{\{root\}\}/g, root));
  }

  // Run bun build cli. In the future we can move to using `Bun.Bundler`
  const cmd = (
    !ESBUILD
      ? [
          ...(process.env.BUN_DEBUGGER ? ["lldb-server", "g:1234", "--"] : []),
          BUN_EXE,
          "build",
          ...entryPaths,
          ...(entryPointsRaw ?? []),
          outfile ? `--outfile=${outfile}` : `--outdir=${outdir}`,
          define && Object.entries(define).map(([k, v]) => ["--define", `${k}=${v}`]),
          `--platform=${platform}`,
          external && external.map(x => ["--external", x]),
          minifyIdentifiers && `--minify-identifiers`,
          minifySyntax && `--minify-syntax`,
          minifyWhitespace && `--minify-whitespace`,
          globalName && `--global-name=${globalName}`,
          // inject && inject.map(x => ["--inject", path.join(root, x)]),
          jsx.automaticRuntime === false && "--jsx=classic",
          jsx.factory && `--jsx-factory=${jsx.factory}`,
          jsx.fragment && `--jsx-fragment=${jsx.fragment}`,
          jsx.development === false && `--jsx-production`,
          // metafile && `--metafile=${metafile}`,
          // sourceMap && `--sourcemap${sourceMap !== true ? `=${sourceMap}` : ""}`,
          entryNames && entryNames !== "[name].[ext]" && [`--entry-names`, entryNames],
          // `--format=${format}`,
          // legalComments && `--legal-comments=${legalComments}`,
          splitting && `--splitting`,
          // treeShaking && `--tree-shaking`,
          // outbase && `--outbase=${outbase}`,
          // keepNames && `--keep-names`,
          // mainFields && `--main-fields=${mainFields}`,
          // loader && Object.entries(loader).map(([k, v]) => ["--loader", `${k}=${v}`]),
        ]
      : [
          ESBUILD_PATH,
          mode === "bundle" && "--bundle",
          outfile ? `--outfile=${outfile}` : `--outdir=${outdir}`,
          `--format=${format}`,
          `--platform=${platform === "bun" ? "node" : platform}`,
          minifyIdentifiers && `--minify-identifiers`,
          minifySyntax && `--minify-syntax`,
          minifyWhitespace && `--minify-whitespace`,
          globalName && `--global-name=${globalName}`,
          external && external.map(x => `--external:${x}`),
          inject && inject.map(x => `--inject:${path.join(root, x)}`),
          define && Object.entries(define).map(([k, v]) => `--define:${k}=${v}`),
          jsx.automaticRuntime && "--jsx=automatic",
          jsx.factory && `--jsx-factory=${jsx.factory}`,
          jsx.fragment && `--jsx-fragment=${jsx.fragment}`,
          jsx.development && `--jsx-dev`,
          entryNames && entryNames !== "[name].[ext]" && `--entry-names=${entryNames.replace(/\.\[ext]$/, "")}`,
          metafile && `--metafile=${metafile}`,
          sourceMap && `--sourcemap${sourceMap !== true ? `=${sourceMap}` : ""}`,
          banner && `--banner:js=${banner}`,
          legalComments && `--legal-comments=${legalComments}`,
          splitting && `--splitting`,
          treeShaking && `--tree-shaking`,
          outbase && `--outbase=${path.join(root, outbase)}`,
          keepNames && `--keep-names`,
          mainFields && `--main-fields=${mainFields.join(",")}`,
          loader && Object.entries(loader).map(([k, v]) => `--loader:${k}=${v}`),
          [...(unsupportedJSFeatures ?? []), ...(unsupportedCSSFeatures ?? [])].map(x => `--supported:${x}=false`),
          ...entryPaths,
          ...(entryPointsRaw ?? []),
        ]
  )
    .flat(Infinity)
    .filter(Boolean)
    .map(x => String(x)) as [string, ...string[]];

  if (DEBUG) {
    writeFileSync(
      path.join(root, "run.sh"),
      "#!/bin/sh\n" + cmd.map(x => (x.match(/^[a-z0-9_:=\./\\-]+$/i) ? x : `"${x.replace(/"/g, '\\"')}"`)).join(" "),
    );
    try {
      mkdirSync(path.join(root, ".vscode"), { recursive: true });
    } catch (e) {}

    writeFileSync(
      path.join(root, ".vscode", "launch.json"),
      JSON.stringify(
        {
          "version": "0.2.0",
          "configurations": [
            {
              "type": "lldb",
              "request": "launch",
              "name": "bun test",
              "program": cmd[0],
              "args": cmd.slice(1),
              "cwd": root,
              "env": {
                "FORCE_COLOR": "1",
              },
              "console": "internalConsole",
            },
          ],
        },
        null,
        2,
      ),
    );
  }

  const { stdout, stderr, success } = Bun.spawnSync({
    cmd,
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });

  // Check for errors
  const expectedErrors = bundleErrors
    ? Object.entries(bundleErrors).flatMap(([file, v]) => v.map(error => ({ file, error })))
    : null;

  if (!success) {
    if (!ESBUILD) {
      const errorRegex = /^error: (.*?)\n(?:.*?\n\s*\^\s*\n(.*?)\n)?/gms;
      const allErrors = [...stderr!.toString("utf-8").matchAll(errorRegex)].map(([_str1, error, source]) => {
        if (!source) {
          return { error, file: "<bun>" };
        }
        const [_str2, fullFilename, line, col] = source.match(/bun-build-tests\/(.*):(\d+):(\d+)/)!;
        const file = fullFilename.slice(id.length + path.basename(outBase).length + 1);
        return { error, file, line, col };
      });

      if (allErrors.length === 0) {
        console.log(stderr!.toString("utf-8"));
      }

      if (stderr!.toString("utf-8").includes("Crash report saved to:")) {
        throw new Error("Bun crashed during build");
      }

      if (DEBUG && allErrors.length) {
        console.log("REFERENCE ERRORS OBJECT");
        console.log("bundleErrors: {");
        const files: any = {};
        for (const err of allErrors) {
          files[err.file] ??= [];
          files[err.file].push(err);
        }
        for (const [file, errs] of Object.entries(files)) {
          console.log('  "' + file + '": [');
          for (const err of errs as any) {
            console.log("    `" + err.error + "`");
          }
          console.log("  ],");
        }
        console.log("},");
      }

      if (expectedErrors) {
        const errorsLeft = [...expectedErrors];
        let unexpectedErrors = [];

        for (const error of allErrors) {
          const i = errorsLeft.findIndex(item => error.file === item.file && item.error === error.error);
          if (i === -1) {
            unexpectedErrors.push(error);
          } else {
            errorsLeft.splice(i, 1);
          }
        }

        if (unexpectedErrors.length) {
          throw new Error(
            "Unexpected errors reported while bundling:\n" +
              [...unexpectedErrors].map(formatError).join("\n") +
              "\n\nExpected errors:\n" +
              expectedErrors.map(formatError).join("\n"),
          );
        }

        if (errorsLeft.length) {
          throw new Error("Errors were expected while bundling:\n" + errorsLeft.map(formatError).join("\n"));
        }

        return;
      }
      throw new Error("Bundle Failed\n" + [...allErrors].map(formatError).join("\n"));
    } else if (!expectedErrors) {
      throw new Error("Bundle Failed\n" + stderr?.toString("utf-8"));
    }
    return;
  } else if (expectedErrors) {
    throw new Error("Errors were expected while bundling:\n" + expectedErrors.map(formatError).join("\n"));
  }

  // Check for warnings
  let warningReference: Record<string, { file: string; error: string; line?: string; col?: string }[]> = {};
  if (!ESBUILD) {
    const warningRegex = /^warn: (.*?)\n.*?\n\s*\^\s*\n(.*?)\n/gms;
    const allWarnings = [...stderr!.toString("utf-8").matchAll(warningRegex)].map(([_str1, error, source]) => {
      const [_str2, fullFilename, line, col] = source.match(/bun-build-tests\/(.*):(\d+):(\d+)/)!;
      const file = fullFilename.slice(id.length + path.basename(outBase).length + 1);
      return { error, file, line, col };
    });
    const expectedWarnings = bundleWarnings
      ? Object.entries(bundleWarnings).flatMap(([file, v]) => v.map(error => ({ file, error })))
      : null;

    for (const err of allWarnings) {
      warningReference[err.file] ??= [];
      warningReference[err.file].push(err);
    }
    if (DEBUG && allWarnings.length) {
      console.log("REFERENCE WARNINGS OBJECT");
      console.log("bundleWarnings: {");
      for (const [file, errs] of Object.entries(warningReference)) {
        console.log('  "' + file + '": [');
        for (const err of errs as any) {
          console.log("    `" + err.error + "`");
        }
        console.log("  ],");
      }
      console.log("},");
    }

    if (allWarnings.length > 0 && !expectedWarnings) {
      throw new Error("Warnings were thrown while bundling:\n" + allWarnings.map(formatError).join("\n"));
    } else if (expectedWarnings) {
      const warningsLeft = [...expectedWarnings];
      let unexpectedWarnings = [];

      for (const error of allWarnings) {
        const i = warningsLeft.findIndex(item => error.file === item.file && item.error.includes(error.error));
        if (i === -1) {
          unexpectedWarnings.push(error);
        } else {
          warningsLeft.splice(i, 1);
        }
      }

      if (unexpectedWarnings.length) {
        throw new Error(
          "Unexpected warnings reported while bundling:\n" +
            [...unexpectedWarnings].map(formatError).join("\n") +
            "\n\nExpected warnings:\n" +
            expectedWarnings.map(formatError).join("\n"),
        );
      }

      if (warningsLeft.length) {
        throw new Error("Warnings were expected while bundling:\n" + warningsLeft.map(formatError).join("\n"));
      }
    }
  }

  const readCache: Record<string, string> = {};
  const readFile = (file: string) =>
    readCache[file] || (readCache[file] = readFileSync(path.join(root, file), "utf-8"));
  const writeFile = (file: string, contents: string) => {
    readCache[file] = contents;
    writeFileSync(path.join(root, file), contents);
  };
  const api = {
    root,
    outfile: outfile!,
    outdir: outdir!,
    readFile,
    writeFile,
    expectFile: file => expect(readFile(file)),
    prependFile: (file, contents) => writeFile(file, dedent(contents) + "\n" + readFile(file)),
    appendFile: (file, contents) => writeFile(file, readFile(file) + "\n" + dedent(contents)),
    assertFileExists: file => {
      if (!existsSync(path.join(root, file))) {
        throw new Error("Expected file to be written: " + file);
      }
    },
    warnings: warningReference,
    options: opts,
  } satisfies BundlerTestBundleAPI;

  // DCE keep scan
  let keepMarkers: Record<string, number> = typeof dceKeepMarkerCount === "object" ? dceKeepMarkerCount : {};
  let keepMarkersFound = 0;
  if (dce && typeof dceKeepMarkerCount !== "number" && dceKeepMarkerCount !== false) {
    for (const file of Object.entries(files)) {
      keepMarkers[outfile ? outfile : path.join(outdir!, file[0]).slice(root.length).replace(/\.ts$/, ".js")] ??= [
        ...file[1].matchAll(/KEEP/gi),
      ].length;
    }
  }

  // Check that the bundle failed with status code 0 by verifying all files exist.
  // TODO: clean up this entire bit into one main loop
  if (outfile) {
    if (!existsSync(outfile)) {
      throw new Error("Bundle was not written to disk: " + outfile);
    } else {
      const content = readFileSync(outfile).toString();
      if (dce) {
        const dceFails = [...content.matchAll(/FAIL|FAILED|DROP|REMOVE/gi)];
        if (dceFails.length) {
          throw new Error("DCE test did not remove all expected code in " + outfile + ".");
        }
        if (dceKeepMarkerCount !== false) {
          const keepMarkersThisFile = [...content.matchAll(/KEEP/gi)].length;
          keepMarkersFound += keepMarkersThisFile;
          if (
            (typeof dceKeepMarkerCount === "number"
              ? dceKeepMarkerCount
              : Object.values(keepMarkers).reduce((a, b) => a + b, 0)) !== keepMarkersThisFile
          ) {
            throw new Error(
              "DCE keep markers were not preserved in " +
                outfile +
                ". Expected " +
                keepMarkers[outfile] +
                " but found " +
                keepMarkersThisFile +
                ".",
            );
          }
        }
      }
      if (!ESBUILD) {
        // expect(readFileSync(outfile).toString()).toMatchSnapshot(outfile.slice(root.length));
      }
    }
  } else {
    // entryNames makes it so we cannot predict the output file
    if (!entryNames || entryNames === "[name].[ext]") {
      for (const fullpath of outputPaths) {
        if (!existsSync(fullpath)) {
          throw new Error("Bundle was not written to disk: " + fullpath);
        } else {
          if (!ESBUILD) {
            // expect(readFileSync(fullpath).toString()).toMatchSnapshot(fullpath.slice(root.length));
          }
          if (dce) {
            const content = readFileSync(fullpath, "utf8");
            const dceFails = [...content.matchAll(/FAIL|FAILED|DROP|REMOVE/gi)];
            const key = fullpath.slice(root.length);
            if (dceFails.length) {
              throw new Error("DCE test did not remove all expected code in " + key + ".");
            }
            if (dceKeepMarkerCount !== false) {
              const keepMarkersThisFile = [...content.matchAll(/KEEP/gi)].length;
              keepMarkersFound += keepMarkersThisFile;
              if (keepMarkers[key] !== keepMarkersThisFile) {
                throw new Error(
                  "DCE keep markers were not preserved in " +
                    key +
                    ". Expected " +
                    keepMarkers[key] +
                    " but found " +
                    keepMarkersThisFile +
                    ".",
                );
              }
            }
          }
        }
      }
    } else if (!ESBUILD) {
      // TODO: snapshot these test cases
    }
  }
  if (
    dce &&
    dceKeepMarkerCount !== false &&
    typeof dceKeepMarkerCount === "number" &&
    keepMarkersFound !== dceKeepMarkerCount
  ) {
    throw new Error(
      `DCE keep markers were not preserved. Expected ${dceKeepMarkerCount} KEEP markers, but found ${keepMarkersFound}.`,
    );
  }

  if (assertNotPresent) {
    for (const [key, value] of Object.entries(assertNotPresent)) {
      const filepath = path.join(root, key);
      if (existsSync(filepath)) {
        const strings = Array.isArray(value) ? value : [value];
        for (const str of strings) {
          if (api.readFile(key).includes(str)) throw new Error(`Expected ${key} to not contain "${str}"`);
        }
      }
    }
  }

  // Write runtime files to disk as well as run the post bundle hook.
  for (const [file, contents] of Object.entries(runtimeFiles ?? {})) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), dedent(contents).replace(/\{\{root\}\}/g, root));
  }

  if (onAfterBundle) {
    onAfterBundle(api);
  }

  // Runtime checks!
  if (run) {
    const runs = Array.isArray(run) ? run : [run];
    let i = 0;
    for (const run of runs) {
      let prefix = runs.length === 1 ? "" : `[run ${i++}] `;

      let file = run.file;
      if (file) {
        file = path.join(root, file);
      } else if (entryPaths.length === 1) {
        file = outfile;
      } else {
        throw new Error(prefix + "run.file is required when there is more than one entrypoint.");
      }

      const { success, stdout, stderr } = Bun.spawnSync({
        cmd: [
          (run.runtime ?? "bun") === "bun" ? bunExe() : "node",
          ...(run.bunArgs ?? []),
          file,
          ...(run.args ?? []),
        ] as [string, ...string[]],
        env: {
          ...bunEnv,
          FORCE_COLOR: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (run.error) {
        if (success) {
          throw new Error(
            prefix +
              "Bundle should have thrown at runtime\n" +
              stdout!.toString("utf-8") +
              "\n" +
              stderr!.toString("utf-8"),
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
            throw new Error(`${prefix}Runtime failed with no error. Expecting "${run.error}"`);
          }
          expect(error).toBe(run.error);

          if (run.errorLineMatch) {
            const stackTraceLine = stack.pop()!;
            const match = /at (.*):(\d+):(\d+)$/.exec(stackTraceLine);
            if (match) {
              const line = readFileSync(match[1], "utf-8").split("\n")[+match[2] - 1];
              if (!run.errorLineMatch.test(line)) {
                throw new Error(`${prefix}Source code "${line}" does not match expression ${run.errorLineMatch}`);
              }
            } else {
              throw new Error(prefix + "Could not trace error.");
            }
          }
        }
      } else if (!success) {
        throw new Error(prefix + "Runtime failed\n" + stdout!.toString("utf-8") + "\n" + stderr!.toString("utf-8"));
      }

      if (run.stdout !== undefined) {
        const result = stdout!.toString("utf-8").trim();
        const expected = dedent(run.stdout).trim();
        if (expected !== result) {
          console.log({ file });
        }
        expect(result).toBe(expected);
      }
    }
  }
}

/** Shorthand for test and expectBundled. See `expectBundled` for what this does.
 */
export function itBundled(id: string, opts: BundlerTestInput) {
  const { it } = testForFile(callerSourceOrigin());

  if (FILTER && id !== FILTER) {
    return;
  } else if (!FILTER) {
    try {
      expectBundled(id, opts, true);
    } catch (error) {
      it.skip(id, () => {});
      return;
    }
  }

  it(id, () => expectBundled(id, opts));
}
itBundled.skip = (id: string, opts: BundlerTestInput) => {
  const { it } = testForFile(callerSourceOrigin());
  return it.skip(id, () => expectBundled(id, opts));
};

/** version of test that applies filtering */
export function bundlerTest(id: string, cb: () => void) {
  if (FILTER && id !== FILTER) {
    return;
  }
  const { it } = testForFile(callerSourceOrigin());
  it(id, cb);
}
bundlerTest.skip = (id: string, cb: any) => {
  const { it } = testForFile(callerSourceOrigin());
  return it.skip(id, cb);
};

function formatError(err: { file: string; error: string; line?: string; col?: string }) {
  return `${err.file}${err.line ? " :" + err.line : ""}${err.col ? ":" + err.col : ""}: ${err.error}`;
}
