/**
 * See `./expectBundled.md` for how this works.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import dedent from "dedent";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { callerSourceOrigin } from "bun:jsc";
import { BuildConfig, BunPlugin, fileURLToPath } from "bun";
import type { Expect } from "bun:test";
import { PluginBuilder } from "bun";
import * as esbuild from "esbuild";

let currentFile: string | undefined;

type BunTestExports = typeof import("bun:test");
export function testForFile(file: string): BunTestExports {
  if (file.startsWith("file://")) {
    file = fileURLToPath(new URL(file));
  }

  var testFile = testFiles.get(file);
  if (!testFile) {
    testFile = Bun.jest(file);
    testFiles.set(file, testFile);
  }
  return testFile;
}

/** Use `esbuild` instead of `bun build` */
export const ESBUILD = process.env.BUN_BUNDLER_TEST_USE_ESBUILD;
/** Write extra files to disk and log extra info. */
const DEBUG = process.env.BUN_BUNDLER_TEST_DEBUG;
/** Set this to the id of a bundle test to run just that test */
const FILTER = process.env.BUN_BUNDLER_TEST_FILTER;
/** Set this to hide skips */
const HIDE_SKIP = process.env.BUN_BUNDLER_TEST_HIDE_SKIP;
/** Path to the bun. */
const BUN_EXE = (process.env.BUN_EXE && Bun.which(process.env.BUN_EXE)) ?? bunExe();
export const RUN_UNCHECKED_TESTS = false;

const outBaseTemplate = path.join(tmpdir(), "bun-build-tests", `${ESBUILD ? "esbuild" : "bun"}-`);
if (!existsSync(path.dirname(outBaseTemplate))) mkdirSync(path.dirname(outBaseTemplate), { recursive: true });
const outBase = mkdtempSync(outBaseTemplate);
const testsRan = new Set();

if (ESBUILD) {
  console.warn("NOTE: using esbuild for bun build tests");
}

export const ESBUILD_PATH = import.meta.resolveSync("esbuild/bin/esbuild");

export interface BundlerTestInput {
  /** Temporary flag to mark failing tests as skipped. */
  todo?: boolean;

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
  /** Defaults to true */
  bundling?: boolean;
  /** Used for `default/ErrorMessageCrashStdinESBuildIssue2913`. */
  stdin?: { contents: string; cwd: string };
  /** Use when doing something weird with entryPoints and you need to check other output paths. */
  outputPaths?: string[];
  /** Use --compile */
  compile?: boolean;

  /** force using cli or js api. defaults to api if possible, then cli otherwise */
  backend?: "cli" | "api";

  // bundler options
  alias?: Record<string, string>;
  assetNaming?: string;
  banner?: string;
  define?: Record<string, string | number>;
  /** Default is "[name].[ext]" */
  entryNaming?: string;
  /** Default is "[name]-[hash].[ext]" */
  chunkNaming?: string;
  extensionOrder?: string[];
  /** Replaces "{{root}}" with the file root */
  external?: string[];
  /** Defaults to "esm" */
  format?: "esm" | "cjs" | "iife";
  globalName?: string;
  ignoreDCEAnnotations?: boolean;
  inject?: string[];
  jsx?: {
    runtime?: "automatic" | "classic";
    importSource?: string; // for automatic
    factory?: string; // for classic
    fragment?: string; // for classic
  };
  root?: string;
  /** Defaults to `/out.js` */
  outfile?: string;
  /** Defaults to `/out` */
  outdir?: string;
  /** Defaults to "browser". "bun" is set to "node" when using esbuild. */
  target?: "bun" | "node" | "browser";
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
  serverComponents?: boolean;
  treeShaking?: boolean;
  unsupportedCSSFeatures?: string[];
  unsupportedJSFeatures?: string[];
  /** if set to true or false, create or edit tsconfig.json to set compilerOptions.useDefineForClassFields */
  useDefineForClassFields?: boolean;
  sourceMap?: "inline" | "external" | "none";
  plugins?: BunPlugin[] | ((builder: PluginBuilder) => void | Promise<void>);
  install?: string[];

  // pass subprocess.env
  env?: Record<string, any>;
  nodePaths?: string[];

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
   * Shorthand for testing CJS->ESM cases.
   * Checks source code for the commonjs helper.
   *
   * Set to true means all cjs files should be converted. You can pass `unhandled` to expect them
   * to stay commonjs (will throw if esm)
   */
  cjs2esm?: boolean | { unhandled: string[] };
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

  /** Compares output files from another test. Used for example in `ts/TSMinifyNestedEnumNoLogicalAssignment` because the output is exactly the same. */
  matchesReference?: {
    ref: BundlerTestRef;
    files: string[];
  };

  /** Captures `capture()` function calls in the output. */
  capture?: string[];

  /** Run after bundle happens but before runtime. */
  onAfterBundle?(api: BundlerTestBundleAPI): void;

  /* TODO: remove this from the tests after this is implemented */
  skipIfWeDidNotImplementWildcardSideEffects?: boolean;
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
  /**
   * Finds all `capture(...)` calls and returns the strings within each function call.
   */
  captureFile(file: string, fnName?: string): string[];

  warnings: Record<string, ErrorMeta[]>;
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
  stdout?: string | RegExp;
  /** partial match stdout (toContain()) */
  partialStdout?: string;
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

/** given when you do itBundled('id', (this object) => BundlerTestInput) */
export interface BundlerTestWrappedAPI {
  root: string;
  getConfigRef: () => BuildConfig;
}

let configRef: BuildConfig;
function getConfigRef() {
  return configRef;
}

export interface BundlerTestRef {
  id: string;
  options: BundlerTestInput;
}

interface ErrorMeta {
  file: string;
  error: string;
  line?: string;
  col?: string;
}

var testFiles = new Map();

function testRef(id: string, options: BundlerTestInput): BundlerTestRef {
  return { id, options };
}

function expectBundled(
  id: string,
  opts: BundlerTestInput,
  dryRun = false,
  ignoreFilter = false,
): Promise<BundlerTestRef> | BundlerTestRef {
  var { expect, it, test } = testForFile(currentFile ?? callerSourceOrigin());
  if (!ignoreFilter && FILTER && !filterMatches(id)) return testRef(id, opts);

  let {
    assertNotPresent,
    assetNaming,
    backend,
    banner,
    bundleErrors,
    bundleWarnings,
    bundling,
    capture,
    chunkNaming,
    cjs2esm,
    compile,
    dce,
    dceKeepMarkerCount,
    define,
    entryNaming,
    entryPoints,
    entryPointsRaw,
    env,
    external,
    files,
    format,
    globalName,
    inject,
    install,
    jsx = {},
    keepNames,
    legalComments,
    loader,
    mainFields,
    matchesReference,
    metafile,
    minifyIdentifiers,
    minifySyntax,
    minifyWhitespace,
    todo: notImplemented,
    onAfterBundle,
    root: outbase,
    outdir,
    outfile,
    outputPaths,
    plugins,
    publicPath,
    run,
    runtimeFiles,
    serverComponents = false,
    skipOnEsbuild,
    sourceMap,
    splitting,
    target,
    treeShaking,
    unsupportedCSSFeatures,
    unsupportedJSFeatures,
    useDefineForClassFields,
    // @ts-expect-error
    _referenceFn,
    ...unknownProps
  } = opts;

  if (serverComponents) {
    splitting = true;
  }

  // TODO: Remove this check once all options have been implemented
  if (Object.keys(unknownProps).length > 0) {
    throw new Error("expectBundled recieved unexpected options: " + Object.keys(unknownProps).join(", "));
  }

  // This is a sanity check that protects against bad copy pasting.
  if (testsRan.has(id)) {
    throw new Error(`expectBundled("${id}", ...) was called twice. Check your tests for bad copy+pasting.`);
  }

  // Resolve defaults for options and some related things
  bundling ??= true;
  target ??= "browser";
  format ??= "esm";
  entryPoints ??= entryPointsRaw ? [] : [Object.keys(files)[0]];
  if (run === true) run = {};
  if (metafile === true) metafile = "/metafile.json";
  if (bundleErrors === true) bundleErrors = {};
  if (bundleWarnings === true) bundleWarnings = {};
  const useOutFile = outfile ? true : outdir ? false : entryPoints.length === 1;

  if (bundling === false && entryPoints.length > 1) {
    throw new Error("bundling:false only supports a single entry point");
  }
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
  if (!ESBUILD && keepNames) {
    throw new Error("keepNames not implemented in bun build");
  }
  if (!ESBUILD && mainFields) {
    throw new Error("mainFields not implemented in bun build");
  }
  if (!ESBUILD && banner) {
    throw new Error("banner not implemented in bun build");
  }
  if (!ESBUILD && inject) {
    throw new Error("inject not implemented in bun build");
  }
  if (!ESBUILD && loader) {
    const loaderValues = [...new Set(Object.values(loader))];
    const supportedLoaderTypes = ["js", "jsx", "ts", "tsx", "css", "json", "text", "file", "wtf", "toml"];
    const unsupportedLoaderTypes = loaderValues.filter(x => !supportedLoaderTypes.includes(x));
    if (unsupportedLoaderTypes.length) {
      throw new Error(`loader '${unsupportedLoaderTypes.join("', '")}' not implemented in bun build`);
    }
  }
  if (ESBUILD && skipOnEsbuild) {
    return testRef(id, opts);
  }
  if (dryRun) {
    return testRef(id, opts);
  }

  return (async () => {
    if (!backend) {
      backend = plugins !== undefined ? "api" : "cli";
    }

    const root = path.join(outBase, id.replaceAll("/", path.sep));
    if (DEBUG) console.log("root:", root);

    const entryPaths = entryPoints.map(file => path.join(root, file));

    if (external) {
      external = external.map(x => (typeof x !== "string" ? x : x.replace(/\{\{root\}\}/g, root)));
    }

    outfile = useOutFile ? path.join(root, outfile ?? (compile ? "/out" : "/out.js")) : undefined;
    outdir = !useOutFile ? path.join(root, outdir ?? "/out") : undefined;
    metafile = metafile ? path.join(root, metafile) : undefined;
    outputPaths = (
      outputPaths
        ? outputPaths.map(file => path.join(root, file))
        : entryPaths.map(file => path.join(outdir!, path.basename(file)))
    ).map(x => x.replace(/\.ts$/, ".js"));

    if (cjs2esm && !outfile && !minifySyntax && !minifyWhitespace) {
      throw new Error("cjs2esm=true requires one output file, minifyWhitespace=false, and minifySyntax=false");
    }

    if (outdir) {
      entryNaming ??= "[dir]/[name].[ext]";
      chunkNaming ??= "[name]-[hash].[ext]";
    }

    if (outbase) {
      outbase = path.join(root, outbase);
    }

    // Option validation
    if (entryPaths.length !== 1 && outfile && !entryPointsRaw) {
      throw new Error("Test cannot specify `outfile` when more than one entry path.");
    }

    // Prepare source folder
    if (existsSync(root)) {
      rmSync(root, { recursive: true });
    }
    mkdirSync(root, { recursive: true });
    if (install) {
      const installProcess = Bun.spawnSync({
        cmd: [bunExe(), "install", ...install],
        cwd: root,
      });
      if (!installProcess.success) {
        throw new Error("Failed to install dependencies");
      }
    }
    for (const [file, contents] of Object.entries(files)) {
      const filename = path.join(root, file);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, dedent(contents).replace(/\{\{root\}\}/g, root));
    }

    if (useDefineForClassFields !== undefined) {
      if (existsSync(path.join(root, "tsconfig.json"))) {
        try {
          const tsconfig = JSON.parse(readFileSync(path.join(root, "tsconfig.json"), "utf8"));
          tsconfig.compilerOptions = tsconfig.compilerOptions ?? {};
          tsconfig.compilerOptions.useDefineForClassFields = useDefineForClassFields;
          writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
        } catch (error) {
          console.log(
            "DEBUG NOTE: specifying useDefineForClassFields causes tsconfig.json to be parsed as JSON and not JSONC.",
          );
        }
      } else {
        writeFileSync(
          path.join(root, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { useDefineForClassFields } }, null, 2),
        );
      }
    }

    // Run bun build cli. In the future we can move to using `Bun.Bundler`
    let warningReference: Record<string, ErrorMeta[]> = {};
    const expectedErrors = bundleErrors
      ? Object.entries(bundleErrors).flatMap(([file, v]) => v.map(error => ({ file, error })))
      : null;

    if (backend === "cli") {
      if (plugins) {
        throw new Error("plugins not possible in backend=CLI");
      }
      const cmd = (
        !ESBUILD
          ? [
              ...(process.env.BUN_DEBUGGER ? ["lldb-server", "g:1234", "--"] : []),
              BUN_EXE,
              "build",
              ...entryPaths,
              ...(entryPointsRaw ?? []),
              bundling === false ? "--no-bundle" : [],
              compile ? "--compile" : [],
              outfile ? `--outfile=${outfile}` : `--outdir=${outdir}`,
              define && Object.entries(define).map(([k, v]) => ["--define", `${k}=${v}`]),
              `--target=${target}`,
              // `--format=${format}`,
              external && external.map(x => ["--external", x]),
              minifyIdentifiers && `--minify-identifiers`,
              minifySyntax && `--minify-syntax`,
              minifyWhitespace && `--minify-whitespace`,
              globalName && `--global-name=${globalName}`,
              jsx.runtime && ["--jsx-runtime", jsx.runtime],
              jsx.factory && ["--jsx-factory", jsx.factory],
              jsx.fragment && ["--jsx-fragment", jsx.fragment],
              jsx.importSource && ["--jsx-import-source", jsx.importSource],
              // metafile && `--manifest=${metafile}`,
              sourceMap && `--sourcemap=${sourceMap}`,
              entryNaming && entryNaming !== "[dir]/[name].[ext]" && [`--entry-naming`, entryNaming],
              chunkNaming && chunkNaming !== "[name]-[hash].[ext]" && [`--chunk-naming`, chunkNaming],
              assetNaming && assetNaming !== "[name]-[hash].[ext]" && [`--asset-naming`, assetNaming],
              splitting && `--splitting`,
              serverComponents && "--server-components",
              outbase && `--root=${outbase}`,
              // inject && inject.map(x => ["--inject", path.join(root, x)]),
              // jsx.preserve && "--jsx=preserve",
              // legalComments && `--legal-comments=${legalComments}`,
              // treeShaking === false && `--no-tree-shaking`, // ??
              // keepNames && `--keep-names`,
              // mainFields && `--main-fields=${mainFields}`,
              loader && Object.entries(loader).map(([k, v]) => ["--loader", `${k}:${v}`]),
              publicPath && `--public-path=${publicPath}`,
            ]
          : [
              ESBUILD_PATH,
              bundling && "--bundle",
              outfile ? `--outfile=${outfile}` : `--outdir=${outdir}`,
              `--format=${format}`,
              `--platform=${target === "bun" ? "node" : target}`,
              minifyIdentifiers && `--minify-identifiers`,
              minifySyntax && `--minify-syntax`,
              minifyWhitespace && `--minify-whitespace`,
              globalName && `--global-name=${globalName}`,
              external && external.map(x => `--external:${x}`),
              inject && inject.map(x => `--inject:${path.join(root, x)}`),
              define && Object.entries(define).map(([k, v]) => `--define:${k}=${v}`),
              `--jsx=${jsx.runtime === "classic" ? "transform" : "automatic"}`,
              // jsx.preserve && "--jsx=preserve",
              jsx.factory && `--jsx-factory=${jsx.factory}`,
              jsx.fragment && `--jsx-fragment=${jsx.fragment}`,
              env?.NODE_ENV !== "production" && `--jsx-dev`,
              entryNaming &&
                entryNaming !== "[dir]/[name].[ext]" &&
                `--entry-names=${entryNaming.replace(/\.\[ext]$/, "")}`,
              chunkNaming &&
                chunkNaming !== "[name]-[hash].[ext]" &&
                `--chunk-names=${chunkNaming.replace(/\.\[ext]$/, "")}`,
              assetNaming &&
                assetNaming !== "[name]-[hash].[ext]" &&
                `--asset-names=${assetNaming.replace(/\.\[ext]$/, "")}`,
              metafile && `--metafile=${metafile}`,
              sourceMap && `--sourcemap=${sourceMap}`,
              banner && `--banner:js=${banner}`,
              legalComments && `--legal-comments=${legalComments}`,
              splitting && `--splitting`,
              treeShaking && `--tree-shaking`,
              outbase && `--outbase=${outbase}`,
              keepNames && `--keep-names`,
              mainFields && `--main-fields=${mainFields.join(",")}`,
              loader && Object.entries(loader).map(([k, v]) => `--loader:${k}=${v}`),
              publicPath && `--public-path=${publicPath}`,
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
          "#!/bin/sh\n" +
            cmd.map(x => (x.match(/^[a-z0-9_:=\./\\-]+$/i) ? x : `"${x.replace(/"/g, '\\"')}"`)).join(" "),
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
                ...(compile
                  ? [
                      {
                        "type": "lldb",
                        "request": "launch",
                        "name": "run compiled exe",
                        "program": outfile,
                        "args": [],
                        "cwd": root,
                        "env": {
                          "FORCE_COLOR": "1",
                        },
                        "console": "internalConsole",
                      },
                    ]
                  : []),
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

      const bundlerEnv = { ...bunEnv, ...env };
      // remove undefined keys instead of passing "undefined"
      for (const key in bundlerEnv) {
        if (bundlerEnv[key] === undefined) {
          delete bundlerEnv[key];
        }
      }
      const { stdout, stderr, success, exitCode } = Bun.spawnSync({
        cmd,
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: bundlerEnv,
      });

      // Check for errors
      if (!success) {
        if (!ESBUILD) {
          const errorText = stderr.toString("utf-8");
          const errorRegex = /^error: (.*?)\n(?:.*?\n\s*\^\s*\n(.*?)\n)?/gms;
          var skip = false;
          if (errorText.includes("----- bun meta -----")) {
            skip = true;
          }
          const allErrors = skip
            ? []
            : ([...errorText.matchAll(errorRegex)]
                .map(([_str1, error, source]) => {
                  if (!source) {
                    if (error === "FileNotFound") {
                      return null;
                    }
                    return { error, file: "<bun>" };
                  }
                  const [_str2, fullFilename, line, col] = source?.match?.(/bun-build-tests\/(.*):(\d+):(\d+)/) ?? [];
                  const file = fullFilename?.slice?.(id.length + path.basename(outBase).length + 1);

                  return { error, file, line, col };
                })
                .filter(Boolean) as any[]);

          if (allErrors.length === 0) {
            console.log(errorText);
          }

          if (
            errorText.includes("Crash report saved to:") ||
            errorText.includes("panic: reached unreachable code") ||
            errorText.includes("Panic: reached unreachable code") ||
            errorText.includes("Segmentation fault") ||
            errorText.includes("bun has crashed")
          ) {
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
                console.log("    `" + err.error + "`,");
              }
              console.log("  ],");
            }
            console.log("},");
          }

          if (expectedErrors) {
            const errorsLeft = [...expectedErrors];
            let unexpectedErrors = [];

            for (const error of allErrors) {
              const i = errorsLeft.findIndex(item => error.file === item.file && error.error.includes(item.error));
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

            return testRef(id, opts);
          }
          throw new Error("Bundle Failed\n" + [...allErrors].map(formatError).join("\n"));
        } else if (!expectedErrors) {
          throw new Error("Bundle Failed\n" + stderr?.toString("utf-8"));
        }
        return testRef(id, opts);
      } else if (expectedErrors) {
        throw new Error("Errors were expected while bundling:\n" + expectedErrors.map(formatError).join("\n"));
      }

      // Check for warnings
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
              console.log("    `" + err.error + "`,");
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
            const i = warningsLeft.findIndex(item => error.file === item.file && error.error.includes(item.error));
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
    } else {
      const pluginArray = typeof plugins === "function" ? [{ name: "plugin", setup: plugins }] : plugins;
      if (!ESBUILD) {
        const buildOutDir = useOutFile ? path.dirname(outfile!) : outdir!;

        const buildConfig = {
          entrypoints: [...entryPaths, ...(entryPointsRaw ?? [])],
          external,
          minify: {
            whitespace: minifyWhitespace,
            identifiers: minifyIdentifiers,
            syntax: minifySyntax,
          },
          naming: {
            entry: useOutFile ? path.basename(outfile!) : entryNaming,
            chunk: chunkNaming,
            asset: assetNaming,
          },
          plugins: pluginArray,
          treeShaking,
          outdir: buildOutDir,
          sourcemap: sourceMap,
          splitting,
          target,
          publicPath,
        } as BuildConfig;

        if (DEBUG) {
          if (_referenceFn) {
            const x = _referenceFn.toString().replace(/^\s*expect\(.*$/gm, "// $&");
            const debugFile = `import path from 'path';
import assert from 'assert';
const {plugins} = (${x})({ root: ${JSON.stringify(root)} });
const options = ${JSON.stringify({ ...buildConfig, plugins: undefined }, null, 2)};
options.plugins = typeof plugins === "function" ? [{ name: "plugin", setup: plugins }] : plugins;
const build = await Bun.build(options);
if (build.logs) {
  throw build.logs;
}
for (const [key, blob] of build.outputs) {
  await Bun.write(path.join(options.outdir, blob.path), blob.result);
}
`;
            writeFileSync(path.join(root, "run.js"), debugFile);
          } else {
            console.log("TODO: generate run.js, currently only works if options are wrapped in a function");
            console.log("options:", buildConfig);
          }
        }

        configRef = buildConfig;
        const build = await Bun.build(buildConfig);
        configRef = null!;
        Bun.gc(true);

        const buildLogs = build.logs.filter(x => x.level === "error");

        if (buildLogs.length) {
          const allErrors: ErrorMeta[] = [];
          for (const error of buildLogs) {
            const str = error.message ?? String(error);
            if (str.startsWith("\u001B[2mexpect(") || str.startsWith("expect(")) {
              throw error;
            }

            // undocuemnted types
            const position = error.position as {
              lineText: string;
              file: string;
              namespace: string;
              line: number;
              column: number;
              offset: number;
            };

            const filename = position?.file
              ? position.namespace === "file"
                ? "/" + path.relative(root, position.file)
                : `${position.namespace}:${position.file.replace(root, "")}`
              : "<bun>";

            allErrors.push({
              file: filename,
              error: str,
              col: position?.column !== undefined ? String(position.column) : undefined,
              line: position?.line !== undefined ? String(position.line) : undefined,
            });
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
                console.log("    `" + err.error + "`,");
              }
              console.log("  ],");
            }
            console.log("},");
          }

          if (expectedErrors) {
            const errorsLeft = [...expectedErrors];
            let unexpectedErrors = [];

            for (const error of allErrors) {
              const i = errorsLeft.findIndex(item => error.file === item.file && error.error.includes(item.error));
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

            return testRef(id, opts);
          }
          throw new Error("Bundle Failed\n" + [...allErrors].map(formatError).join("\n"));
        } else if (expectedErrors && expectedErrors.length > 0) {
          throw new Error("Errors were expected while bundling:\n" + expectedErrors.map(formatError).join("\n"));
        }
      } else {
        await esbuild.build({
          bundle: true,
          entryPoints: [...entryPaths, ...(entryPointsRaw ?? [])],
          ...(useOutFile ? { outfile: outfile! } : { outdir: outdir! }),
          plugins: pluginArray as any,
        });
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
      captureFile: (file, fnName = "capture") => {
        const fileContents = readFile(file);
        const regex = new RegExp(`\\b${fnName}\\s*\\(((?:\\(\\))?.*?)\\)`, "g");
        const matches = [...fileContents.matchAll(regex)];
        if (matches.length === 0) {
          throw new Error(`No ${fnName} calls found in ${file}`);
        }
        return matches.map(match => match[1]);
      },
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
    // TODO: clean up this entire bit into one main loop\
    if (!compile) {
      if (outfile) {
        if (!existsSync(outfile)) {
          throw new Error("Bundle was not written to disk: " + outfile);
        } else {
          if (dce) {
            const content = readFileSync(outfile).toString();
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
        if (!entryNaming || entryNaming === "[dir]/[name].[ext]") {
          for (const fullpath of outputPaths) {
            if (!existsSync(fullpath)) {
              throw new Error("Bundle was not written to disk: " + fullpath);
            } else {
              if (!ESBUILD) {
                // expect(readFileSync(fullpath).toString()).toMatchSnapshot(fullpath.slice(root.length));
              }
              if (dce) {
                const content = readFileSync(fullpath, "utf8");
                const dceFails = [...content.replace(/\/\*.*?\*\//g, "").matchAll(/FAIL|FAILED|DROP|REMOVE/gi)];
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

      if (capture) {
        const captures = api.captureFile(path.relative(root, outfile ?? outputPaths[0]));
        expect(captures).toEqual(capture);
      }

      // cjs2esm checks
      if (cjs2esm) {
        const outfiletext = api.readFile(path.relative(root, outfile ?? outputPaths[0]));
        const regex = /\/\/\s+(.+?)\nvar\s+([a-zA-Z0-9_$]+)\s+=\s+__commonJS/g;
        const matches = [...outfiletext.matchAll(regex)].map(match => "/" + match[1]);
        const expectedMatches = cjs2esm === true ? [] : cjs2esm.unhandled ?? [];
        try {
          expect(matches.sort()).toEqual(expectedMatches.sort());
        } catch (error) {
          if (matches.length === expectedMatches.length) {
            console.error(`cjs2esm check failed.`);
          } else {
            console.error(
              `cjs2esm check failed. expected ${expectedMatches.length} __commonJS helpers but found ${matches.length}.`,
            );
          }
          throw error;
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

    // check reference
    if (matchesReference) {
      const { ref } = matchesReference;
      const theirRoot = path.join(outBase, ref.id.replaceAll("/", path.sep));
      if (!existsSync(theirRoot)) {
        expectBundled(ref.id, ref.options, false, true);
        if (!existsSync(theirRoot)) {
          console.log("Expected " + theirRoot + " to exist after running reference test");
          throw new Error('Reference test "' + ref.id + '" did not succeed');
        }
      }
      for (const file of matchesReference.files) {
        const ours = path.join(root, file);
        const theirs = path.join(theirRoot, file);
        if (!existsSync(theirs)) throw new Error(`Reference test "${ref.id}" did not write ${file}`);
        if (!existsSync(ours)) throw new Error(`Test did not write ${file}`);
        try {
          expect(readFileSync(ours).toString()).toBe(readFileSync(theirs).toString());
        } catch (error) {
          console.log("Expected reference test " + ref.id + "'s " + file + " to match ours");
          throw error;
        }
      }
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
          file = outfile ?? outputPaths[0];
        } else {
          throw new Error(prefix + "run.file is required when there is more than one entrypoint.");
        }

        const { success, stdout, stderr } = Bun.spawnSync({
          cmd: [
            ...(compile ? [] : [(run.runtime ?? "bun") === "bun" ? bunExe() : "node"]),
            ...(run.bunArgs ?? []),
            file,
            ...(run.args ?? []),
          ] as [string, ...string[]],
          env: {
            ...bunEnv,
            FORCE_COLOR: "0",
            IS_TEST_RUNNER: "1",
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
          if (typeof run.stdout === "string") {
            const expected = dedent(run.stdout).trim();
            if (expected !== result) {
              console.log(`runtime failed file=${file}`);
              console.log(`reference stdout:`);
              console.log(result);
              console.log(`---`);
            }
            expect(result).toBe(expected);
          } else {
            if (!run.stdout.test(result)) {
              console.log(`runtime failed file=${file}`);
              console.log(`reference stdout:`);
              console.log(result);
              console.log(`---`);
            }
            expect(result).toMatch(run.stdout);
          }
        }

        if (run.partialStdout !== undefined) {
          const result = stdout!.toString("utf-8").trim();
          const expected = dedent(run.partialStdout).trim();
          if (!result.includes(expected)) {
            console.log(`runtime failed file=${file}`);
            console.log(`reference stdout:`);
            console.log(result);
            console.log(`---`);
          }
          expect(result).toContain(expected);
        }
      }
    }

    return testRef(id, opts);
  })();
}

/** Shorthand for test and expectBundled. See `expectBundled` for what this does.
 */
export function itBundled(
  id: string,
  opts: BundlerTestInput | ((metadata: BundlerTestWrappedAPI) => BundlerTestInput),
): BundlerTestRef {
  if (typeof opts === "function") {
    const fn = opts;
    opts = opts({ root: path.join(outBase, id.replaceAll("/", path.sep)), getConfigRef });
    // @ts-expect-error
    opts._referenceFn = fn;
  }
  const ref = testRef(id, opts);
  const { it } = testForFile(currentFile ?? callerSourceOrigin()) as any;

  if (FILTER && !filterMatches(id)) {
    return ref;
  } else if (!FILTER) {
    try {
      expectBundled(id, opts, true);
    } catch (error) {
      // it.todo(id, () => {
      //   throw error;
      // });
      return ref;
    }
  }

  if (opts.todo && !FILTER) {
    it.todo(id, () => expectBundled(id, opts as any));
    // it(id, async () => {
    //   try {
    //     await expectBundled(id, opts as any);
    //   } catch (error) {
    //     return;
    //   }
    //   throw new Error(`Expected test to fail but it passed.`);
    // });
  } else {
    it(id, () => expectBundled(id, opts as any));
  }
  return ref;
}
itBundled.skip = (id: string, opts: BundlerTestInput) => {
  if (FILTER && !filterMatches(id)) {
    return testRef(id, opts);
  }
  const { it } = testForFile(currentFile ?? callerSourceOrigin());
  if (!HIDE_SKIP) it.skip(id, () => expectBundled(id, opts));
  return testRef(id, opts);
};

function formatError(err: ErrorMeta) {
  return `${err.file}${err.line ? ":" + err.line : ""}${err.col ? ":" + err.col : ""}: ${err.error}`;
}

function filterMatches(id: string) {
  return FILTER === id || FILTER + "Dev" === id || FILTER + "Prod" === id;
}
