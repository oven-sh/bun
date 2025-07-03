/**
 * See `./expectBundled.md` for how this works.
 */
import { BuildConfig, BuildOutput, BunPlugin, fileURLToPath, PluginBuilder, Loader } from "bun";
import { callerSourceOrigin } from "bun:jsc";
import type { Matchers } from "bun:test";
import * as esbuild from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isCI, isDebug } from "harness";
import { tmpdir } from "os";
import path from "path";
import { SourceMapConsumer } from "source-map";
import filenamify from "filenamify";

/** Dedent module does a bit too much with their stuff. we will be much simpler */
export function dedent(str: string | TemplateStringsArray, ...args: any[]) {
  // https://github.com/tc39/proposal-string-cooked#motivation
  let single_string = String.raw({ raw: str }, ...args);
  single_string = single_string.trim();

  let lines = single_string.split("\n");
  let first_line = lines[0];
  let smallest_indent = Infinity;
  for (let line of lines.slice(1)) {
    let match = line.match(/^\s+/);
    if (match) {
      smallest_indent = Math.min(smallest_indent, match[0].length);
    } else {
      return single_string;
    }
  }

  if (smallest_indent === Infinity) {
    return single_string;
  }

  return (
    first_line +
    "\n" +
    lines
      .slice(1)
      .map(x => x.slice(smallest_indent))
      .join("\n")
  );
}

let currentFile: string | undefined;

function errorOrWarnParser(isError = true) {
  const prefix = isError ? "error: " : "warn: ";
  return function (text: string) {
    var i = 0;
    var list = [];
    while (i < text.length) {
      let errorLineI = text.indexOf(prefix, i);
      if (errorLineI === -1) {
        return list;
      }
      const message = text.slice(errorLineI + prefix.length, text.indexOf("\n", errorLineI + 1));
      i = errorLineI + 1;
      const fileLineI = text.indexOf(" at ", errorLineI + message.length);

      let fileLine = "";
      if (fileLineI !== -1) {
        const fileLineEnd = text.indexOf("\n", fileLineI + 1);
        fileLine = text.slice(fileLineI + "\n    at ".length, fileLineEnd);
        i = fileLineEnd;
      }
      list.push([message, fileLine]);

      if (i === -1) {
        break;
      }
    }
    return list;
  };
}

const errorParser = errorOrWarnParser(true);
const warnParser = errorOrWarnParser(false);

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

const tempDirectoryTemplate = path.join(realpathSync(tmpdir()), "bun-build-tests", `${ESBUILD ? "esbuild" : "bun"}-`);
if (!existsSync(path.dirname(tempDirectoryTemplate)))
  mkdirSync(path.dirname(tempDirectoryTemplate), { recursive: true });
const tempDirectory = mkdtempSync(tempDirectoryTemplate);
const testsRan = new Set();

if (ESBUILD) {
  console.warn("NOTE: using esbuild for bun build tests");
}

export const ESBUILD_PATH = import.meta.resolveSync("esbuild/bin/esbuild");

export interface BundlerTestInput {
  /** Temporary flag to mark failing tests as skipped. */
  todo?: boolean;

  // file options
  files: Record<string, string | Buffer | Uint8ClampedArray | Blob>;
  /** Files to be written only after the bundle is done. */
  runtimeFiles?: Record<string, string | Buffer>;
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
  footer?: string;
  define?: Record<string, string | number>;
  drop?: string[];

  /** Use for resolve custom conditions */
  conditions?: string[];

  /** Default is "[name].[ext]" */
  entryNaming?: string;
  /** Default is "[name]-[hash].[ext]" */
  chunkNaming?: string;
  extensionOrder?: string[];
  /** Replaces "{{root}}" with the file root */
  external?: string[];
  /** Defaults to "bundle" */
  packages?: "bundle" | "external";
  /** Defaults to "esm" */
  format?: "esm" | "cjs" | "iife" | "internal_bake_dev";
  globalName?: string;
  ignoreDCEAnnotations?: boolean;
  bytecode?: boolean;
  emitDCEAnnotations?: boolean;
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
  loader?: Record<`.${string}`, Loader>;
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
  sourceMap?: "inline" | "external" | "linked" | "none" | "linked";
  plugins?: BunPlugin[] | ((builder: PluginBuilder) => void | Promise<void>);
  install?: string[];
  production?: boolean;

  // pass subprocess.env
  env?: Record<string, any>;
  nodePaths?: string[];
  dotenv?: "inline" | "disable" | string;

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

  snapshotSourceMap?: Record<string, SourceMapTests>;

  expectExactFilesize?: Record<string, number>;

  /** Multiplier for test timeout */
  timeoutScale?: number;

  /* determines whether or not anything should be passed to outfile, outdir, etc. */
  generateOutput?: boolean;

  /** Run after the bun.build function is called with its output */
  onAfterApiBundle?(build: BuildOutput): Promise<void> | void;
}

export interface SourceMapTests {
  /** Should be verbaitim equal to the input */
  files: string[];
  /**
   * some tests do not use bun snapshots because they are huge, and doing byte
   * for byte snapshots will not be sustainable. Instead, we will sample a few mappings to make sure
   * the map is correct. This can be used to test for a single mapping.
   */
  mappings?: MappingSnapshot[];
  /** For small files it is acceptable to inline all of the mappings. */
  mappingsExactMatch?: string;
}

/** Keep in mind this is an array/tuple, NOT AN OBJECT. This keeps things more concise */
export type MappingSnapshot = [
  // format a string like "file:line:col", for example
  //    "index.ts:5:2"
  // If column is left out, it is the first non-whitespace character
  //    "index.ts:5"
  // If column is quoted text, find the token and use the column of it
  //    "index.ts:5:'abc'"
  source_code: string,
  generated_mapping: string,
];

export interface BundlerTestBundleAPI {
  root: string;
  outfile: string;
  outdir: string;

  join(subPath: string): string;
  readFile(file: string): string;
  writeFile(file: string, contents: string): void;
  prependFile(file: string, contents: string): void;
  appendFile(file: string, contents: string): void;
  expectFile(file: string): Matchers<string>;
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
  stderr?: string;
  /** partial match stdout (toContain()) */
  partialStdout?: string;
  /** match exact error message, example "ReferenceError: bar is not defined" */
  error?: string;
  /**
   * for extra confidence the error is correctly tested for, a regex for the line it was
   * thrown on can be passed. this should be replaced with a source map lookup when that's
   * available to us.
   */
  errorLineMatch?: RegExp;

  env?: Record<string, string>;

  runtime?: "bun" | "node";

  setCwd?: boolean;
  /** Expect a certain non-zero exit code */
  exitCode?: number;
  /** Run a function with stdout and stderr. Use expect to assert exact outputs */
  validate?: (ctx: { stdout: string; stderr: string }) => void;
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

export interface ErrorMeta {
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
  if (!new Error().stack!.includes("test/bundler/")) {
    throw new Error(
      `All bundler tests must be placed in ./test/bundler/ so that regressions can be quickly detected locally via the 'bun test bundler' command`,
    );
  }

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
    conditions,
    dce,
    dceKeepMarkerCount,
    define,
    entryNaming,
    entryPoints,
    entryPointsRaw,
    env,
    external,
    packages,
    drop = [],
    files,
    footer,
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
    onAfterBundle,
    outdir,
    dotenv,
    outfile,
    outputPaths,
    plugins,
    publicPath,
    root: outbase,
    run,
    runtimeFiles,
    serverComponents = false,
    skipOnEsbuild,
    snapshotSourceMap,
    sourceMap,
    splitting,
    target,
    todo: notImplemented,
    treeShaking,
    unsupportedCSSFeatures,
    unsupportedJSFeatures,
    useDefineForClassFields,
    ignoreDCEAnnotations,
    bytecode = false,
    emitDCEAnnotations,
    production,
    // @ts-expect-error
    _referenceFn,
    expectExactFilesize,
    generateOutput = true,
    onAfterApiBundle,
    ...unknownProps
  } = opts;

  if (serverComponents) {
    splitting = true;
  }

  // TODO: Remove this check once all options have been implemented
  if (Object.keys(unknownProps).length > 0) {
    throw new Error("expectBundled received unexpected options: " + Object.keys(unknownProps).join(", "));
  }

  // This is a sanity check that protects against bad copy pasting.
  if (testsRan.has(id)) {
    throw new Error(`expectBundled("${id}", ...) was called twice. Check your tests for bad copy+pasting.`);
  }

  // Resolve defaults for options and some related things
  bundling ??= true;

  if (bytecode) {
    format ??= "cjs";
    target ??= "bun";
  }

  format ??= "esm";
  target ??= "browser";

  entryPoints ??= entryPointsRaw ? [] : [Object.keys(files)[0]];
  if (run === true) run = {};
  if (metafile === true) metafile = "/metafile.json";
  if (bundleErrors === true) bundleErrors = {};
  if (bundleWarnings === true) bundleWarnings = {};
  const useOutFile = generateOutput == false ? false : outfile ? true : outdir ? false : entryPoints.length === 1;

  if (bundling === false && entryPoints.length > 1) {
    throw new Error("bundling:false only supports a single entry point");
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
  if (!ESBUILD && inject) {
    throw new Error("inject not implemented in bun build");
  }
  if (!ESBUILD && loader) {
    const loaderValues = [...new Set(Object.values(loader))];
    const supportedLoaderTypes = ["js", "jsx", "ts", "tsx", "css", "json", "text", "file", "wtf", "toml"];
    const unsupportedLoaderTypes = loaderValues.filter(x => !supportedLoaderTypes.includes(x));
    if (unsupportedLoaderTypes.length > 0) {
      throw new Error(`loader '${unsupportedLoaderTypes.join("', '")}' not implemented in bun build`);
    }
  }
  if (ESBUILD && bytecode) {
    throw new Error("bytecode not implemented in esbuild");
  }
  if (ESBUILD && skipOnEsbuild) {
    return testRef(id, opts);
  }
  if (ESBUILD && dotenv) {
    throw new Error("dotenv not implemented in esbuild");
  }
  if (dryRun) {
    return testRef(id, opts);
  }

  return (async () => {
    if (!backend) {
      backend = plugins !== undefined ? "api" : "cli";
    }

    let root = path.join(
      tempDirectory,
      id
        .replaceAll("\\", "/")
        .replaceAll(":", "-")
        .replaceAll(" ", "-")
        .replaceAll("\r\n", "-")
        .replaceAll("\n", "-")
        .replaceAll(".", "-")
        .split("/")
        .map(a => filenamify(a))
        .join("/"),
    );

    mkdirSync(root, { recursive: true });
    root = realpathSync(root);
    if (DEBUG) console.log("root:", root);

    const entryPaths = entryPoints.map(file => path.join(root, file));

    if (external) {
      external = external.map(x =>
        typeof x !== "string" ? x : x.replaceAll("{{root}}", root.replaceAll("\\", "\\\\")),
      );
    }

    if (generateOutput === false) outputPaths = [];

    outfile = useOutFile ? path.join(root, outfile ?? (compile ? "/out" : "/out.js")) : undefined;
    outdir = !useOutFile && generateOutput ? path.join(root, outdir ?? "/out") : undefined;
    metafile = metafile ? path.join(root, metafile) : undefined;
    outputPaths = (
      outputPaths
        ? outputPaths.map(file => path.join(root, file))
        : entryPaths.map(file => path.join(outdir || "", path.basename(file).replace(/\.[jt]sx?$/, ".js")))
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
        const reason = installProcess.signalCode || `code ${installProcess.exitCode}`;
        throw new Error(`Failed to install dependencies: ${reason}`);
      }
    }
    for (const [file, contents] of Object.entries(files)) {
      const filename = path.join(root, file);
      mkdirSync(path.dirname(filename), { recursive: true });
      const formattedContents =
        typeof contents === "string"
          ? dedent(contents).replaceAll("{{root}}", root.replaceAll("\\", "\\\\"))
          : contents;
      writeFileSync(filename, formattedContents as any);
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

    // Run bun build cli. In the future we can move to using `Bun.Transpiler.`
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
              `--format=${format}`,
              external && external.map(x => ["--external", x]),
              packages && ["--packages", packages],
              conditions && conditions.map(x => ["--conditions", x]),
              minifyIdentifiers && `--minify-identifiers`,
              minifySyntax && `--minify-syntax`,
              minifyWhitespace && `--minify-whitespace`,
              drop?.length && drop.map(x => ["--drop=" + x]),
              globalName && `--global-name=${globalName}`,
              jsx.runtime && ["--jsx-runtime", jsx.runtime],
              jsx.factory && ["--jsx-factory", jsx.factory],
              jsx.fragment && ["--jsx-fragment", jsx.fragment],
              jsx.importSource && ["--jsx-import-source", jsx.importSource],
              dotenv && ["--env", dotenv],
              // metafile && `--manifest=${metafile}`,
              sourceMap && `--sourcemap=${sourceMap}`,
              entryNaming && entryNaming !== "[dir]/[name].[ext]" && [`--entry-naming`, entryNaming],
              chunkNaming && chunkNaming !== "[name]-[hash].[ext]" && [`--chunk-naming`, chunkNaming],
              assetNaming && assetNaming !== "[name]-[hash].[ext]" && [`--asset-naming`, assetNaming],
              splitting && `--splitting`,
              serverComponents && "--server-components",
              outbase && `--root=${outbase}`,
              banner && `--banner="${banner}"`, // TODO: --banner-css=*
              footer && `--footer="${footer}"`,
              ignoreDCEAnnotations && `--ignore-dce-annotations`,
              emitDCEAnnotations && `--emit-dce-annotations`,
              // inject && inject.map(x => ["--inject", path.join(root, x)]),
              // jsx.preserve && "--jsx=preserve",
              // legalComments && `--legal-comments=${legalComments}`,
              // treeShaking === false && `--no-tree-shaking`, // ??
              // keepNames && `--keep-names`,
              // mainFields && `--main-fields=${mainFields}`,
              loader && Object.entries(loader).map(([k, v]) => ["--loader", `${k}:${v}`]),
              publicPath && `--public-path=${publicPath}`,
              bytecode && "--bytecode",
              production && "--production",
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
              packages && ["--packages", packages],
              conditions && `--conditions=${conditions.join(",")}`,
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
              footer && `--footer:js=${footer}`,
              legalComments && `--legal-comments=${legalComments}`,
              ignoreDCEAnnotations && `--ignore-annotations`,
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
        if (process.platform !== "win32") {
          writeFileSync(
            path.join(root, "run.sh"),
            "#!/bin/sh\n" +
              cmd.map(x => (x.match(/^[a-z0-9_:=\./\\-]+$/i) ? x : `"${x.replace(/"/g, '\\"')}"`)).join(" "),
          );
        } else {
          writeFileSync(
            path.join(root, "run.ps1"),
            cmd.map(x => (x.match(/^[a-z0-9_:=\./\\-]+$/i) ? x : `"${x.replace(/"/g, '\\"')}"`)).join(" "),
          );
        }
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
                        "type": process.platform !== "win32" ? "lldb" : "cppvsdbg",
                        "request": "launch",
                        "name": "run compiled exe",
                        "program": outfile,
                        "args": [],
                        "cwd": root,
                      },
                    ]
                  : []),
                {
                  "type": process.platform !== "win32" ? "lldb" : "cppvsdbg",
                  "request": "launch",
                  "name": "bun test",
                  "program": cmd[0],
                  "args": cmd.slice(1),
                  "cwd": root,
                },
              ],
            },
            null,
            2,
          ),
        );
      }

      const bundlerEnv = { ...bunEnv, ...env };
      // remove undefined keys instead of passing "undefined" and resolve {{root}}
      for (const key in bundlerEnv) {
        const value = bundlerEnv[key];
        if (value === undefined) {
          delete bundlerEnv[key];
        } else if (typeof value === "string") {
          bundlerEnv[key] = value.replaceAll("{{root}}", root);
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
          const errorText = stderr.toUnixString();

          var skip = false;
          if (errorText.includes("----- bun meta -----")) {
            skip = true;
          }

          const allErrors = skip
            ? []
            : (errorParser(errorText)
                .map(([error, source]) => {
                  if (!source) {
                    if (error === "FileNotFound") {
                      return null;
                    }
                    return { error, file: "<bun>" };
                  }
                  const [_str2, fullFilename, line, col] =
                    source?.match?.(/bun-build-tests[\/\\](.*):(\d+):(\d+)/) ?? [];
                  const file = fullFilename
                    ?.slice?.(id.length + path.basename(tempDirectory).length + 1)
                    .replaceAll("\\", "/");

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
          if (allErrors.length === 0) {
            throw new Error("Bundle Failed\ncode: " + exitCode + "\nstdout: " + stdout + "\nstderr: " + stderr);
          }
          throw new Error("Bundle Failed\n" + [...allErrors].map(formatError).join("\n"));
        } else if (!expectedErrors) {
          throw new Error("Bundle Failed\n" + stderr?.toUnixString());
        }
        return testRef(id, opts);
      } else if (expectedErrors) {
        throw new Error("Errors were expected while bundling:\n" + expectedErrors.map(formatError).join("\n"));
      }

      // Check for warnings
      if (!ESBUILD) {
        const warningText = stderr!.toUnixString();
        const allWarnings = warnParser(warningText)
          .map(([error, source]) => {
            if (!source) return;
            const [_str2, fullFilename, line, col] = source.match(/bun-build-tests[\/\\](.*):(\d+):(\d+)/)!;
            const file = fullFilename.slice(id.length + path.basename(tempDirectory).length + 1).replaceAll("\\", "/");
            return { error, file, line, col };
          })
          .filter(Boolean);
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
          packages,
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
          outdir: generateOutput ? buildOutDir : undefined,
          sourcemap: sourceMap,
          splitting,
          target,
          bytecode,
          publicPath,
          emitDCEAnnotations,
          ignoreDCEAnnotations,
          drop,
          define: define ?? {},
          throw: false,
        } as BuildConfig;

        if (dotenv) {
          buildConfig.env = dotenv as any;
        }

        if (conditions?.length) {
          buildConfig.conditions = conditions;
        }

        if (DEBUG) {
          if (_referenceFn) {
            const x = _referenceFn.toString().replace(/^\s*expect\(.*$/gm, "// $&");
            const debugFile = `import path from 'path';
import assert from 'assert';
const {plugins} = (${x})({ root: ${JSON.stringify(root)} });
const options = ${JSON.stringify({ ...buildConfig, plugins: undefined }, null, 2)};
options.plugins = typeof plugins === "function" ? [{ name: "plugin", setup: plugins }] : plugins;
const build = await Bun.build(options);
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
        let build: BuildOutput;
        try {
          build = await Bun.build(buildConfig);
        } catch (e) {
          const err = e as AggregateError;
          build = {
            outputs: [],
            success: false,
            logs: err.errors,
          };
        }
        if (onAfterApiBundle) await onAfterApiBundle(build);
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
      readCache[file] || (readCache[file] = readFileSync(path.join(root, file)).toUnixString());
    const writeFile = (file: string, contents: string) => {
      readCache[file] = contents;
      writeFileSync(path.join(root, file), contents);
    };
    const api = {
      root,
      outfile: outfile!,
      outdir: outdir!,
      join: (...paths: string[]) => path.join(root, ...paths),
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
        let i = 0;
        const length = fileContents.length;
        const matches = [];
        while (i < length) {
          i = fileContents.indexOf(fnName, i);
          if (i === -1) {
            break;
          }
          const start = i;
          let depth = 0;
          while (i < length) {
            const char = fileContents[i];
            if (char === "(") {
              depth++;
            } else if (char === ")") {
              depth--;
              if (depth === 0) {
                break;
              }
            }
            i++;
          }
          if (depth !== 0) {
            throw new Error(`Could not find closing paren for ${fnName} call in ${file}`);
          }
          matches.push(fileContents.slice(start + fnName.length + 1, i));
          i++;
        }

        if (matches.length === 0) {
          throw new Error(`No ${fnName} calls found in ${file}`);
        }
        return matches;
      },
    } satisfies BundlerTestBundleAPI;

    // DCE keep scan
    let keepMarkers: Record<string, number> = typeof dceKeepMarkerCount === "object" ? dceKeepMarkerCount : {};
    let keepMarkersFound = 0;
    if (dce && typeof dceKeepMarkerCount !== "number" && dceKeepMarkerCount !== false) {
      for (const file of Object.entries(files)) {
        keepMarkers[outfile ? outfile : path.join(outdir!, file[0]).slice(root.length).replace(/\.ts$/, ".js")] ??= [
          ...String(file[1]).matchAll(/KEEP/gi),
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
            const content = readFileSync(outfile).toUnixString();
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
        const matches = [...outfiletext.matchAll(regex)].map(match => ("/" + match[1]).replaceAll("\\", "/"));
        const expectedMatches = (cjs2esm === true ? [] : (cjs2esm.unhandled ?? [])).map(a => a.replaceAll("\\", "/"));
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
      const formattedContents =
        typeof contents === "string"
          ? dedent(contents).replaceAll("{{root}}", root.replaceAll("\\", "\\\\"))
          : contents;
      writeFileSync(path.join(root, file), formattedContents);
    }

    if (onAfterBundle) {
      onAfterBundle(api);
    }

    // check reference
    if (matchesReference) {
      const { ref } = matchesReference;
      const theirRoot = path.join(tempDirectory, ref.id);
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
          expect(readFileSync(ours).toUnixString()).toBe(readFileSync(theirs).toUnixString());
        } catch (error) {
          console.log("Expected reference test " + ref.id + "'s " + file + " to match ours");
          throw error;
        }
      }
    }

    // Check that all source maps are valid
    if (opts.sourceMap === "external" && outdir) {
      for (const file_input of readdirSync(outdir, { recursive: true })) {
        const file = file_input.toString("utf8"); // type bug? `file_input` is `Buffer|string`
        if (file.endsWith(".map")) {
          const parsed = await Bun.file(path.join(outdir, file)).json();
          const mappedLocations = new Map();
          await SourceMapConsumer.with(parsed, null, async map => {
            map.eachMapping(m => {
              expect(m.source).toBeDefined();
              expect(m.generatedLine).toBeGreaterThanOrEqual(1);
              expect(m.generatedColumn).toBeGreaterThanOrEqual(0);
              expect(m.originalLine).toBeGreaterThanOrEqual(1);
              expect(m.originalColumn).toBeGreaterThanOrEqual(0);

              const loc_key = `${m.generatedLine}:${m.generatedColumn}`;
              if (mappedLocations.has(loc_key)) {
                const fmtLoc = (loc: any) =>
                  `${loc.generatedLine}:${m.generatedColumn} -> ${m.originalLine}:${m.originalColumn} [${m.source.replaceAll(/^(\.\.\/)+/g, "/").replace(root, "")}]`;

                const a = fmtLoc(mappedLocations.get(loc_key));
                const b = fmtLoc(m);

                // We only care about duplicates that point to
                // multiple source locations.
                if (a !== b) throw new Error("Duplicate mapping in source-map for " + loc_key + "\n" + a + "\n" + b);
              }
              mappedLocations.set(loc_key, { ...m });
            });
            const map_tests = snapshotSourceMap?.[path.basename(file)];
            if (map_tests) {
              expect(parsed.sources.map((a: string) => a.replaceAll("\\", "/"))).toEqual(map_tests.files);
              for (let i = 0; i < parsed.sources; i++) {
                const source = parsed.sources[i];
                const sourcemap_content = parsed.sourceContent[i];
                const actual_content = readFileSync(path.resolve(path.join(outdir!, file), source), "utf-8");
                expect(sourcemap_content).toBe(actual_content);
              }

              const generated_code = await Bun.file(path.join(outdir!, file.replace(".map", ""))).text();

              if (map_tests.mappings)
                for (const mapping of map_tests.mappings) {
                  const src = parseSourceMapStrSource(outdir!, parsed, mapping[0]);
                  const dest = parseSourceMapStrGenerated(generated_code, mapping[1]);
                  const pos = map.generatedPositionFor(src);
                  if (!dest.matched) {
                    const real_generated = generated_code
                      .split("\n")
                      [pos.line! - 1].slice(pos.column!)
                      .slice(0, dest.expected!.length);
                    expect(`${pos.line}:${pos.column}:${real_generated}`).toBe(mapping[1]);
                    throw new Error("Not matched");
                  }
                  expect(pos.line === dest.line);
                  expect(pos.column === dest.column);
                }
              if (map_tests.mappingsExactMatch) {
                expect(parsed.mappings).toBe(map_tests.mappingsExactMatch);
              }
            }
          });
        }
      }
    }

    if (expectExactFilesize) {
      for (const [key, expected] of Object.entries(expectExactFilesize)) {
        const actual = api.readFile(key).length;
        if (actual !== expected) {
          throw new Error(`Expected file ${key} to be ${expected} bytes but was ${actual} bytes.`);
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
        const args = [
          ...(compile ? [] : [(run.runtime ?? "bun") === "bun" ? bunExe() : "node"]),
          ...(run.bunArgs ?? []),
          file,
          ...(run.args ?? []),
        ] as [string, ...string[]];

        const { success, stdout, stderr, exitCode, signalCode } = Bun.spawnSync({
          cmd: args,
          env: {
            ...bunEnv,
            ...(run.env || {}),
            FORCE_COLOR: "0",
            IS_TEST_RUNNER: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
          cwd: run.setCwd ? root : undefined,
        });

        if (signalCode === "SIGTRAP") {
          throw new Error(prefix + "Runtime failed\n" + stdout!.toUnixString() + "\n" + stderr!.toUnixString());
        }

        if (run.error) {
          if (success) {
            throw new Error(
              prefix +
                "Bundle should have thrown at runtime\n" +
                stdout!.toUnixString() +
                "\n" +
                stderr!.toUnixString(),
            );
          }

          if (run.errorLineMatch) {
            // in order to properly analyze the error, we have to look backwards on stderr. this approach
            // most definitely can be improved but it works fine here.
            const stack = [];
            let error;
            const lines = stderr!
              .toUnixString()
              .split("\n")
              // remove `Bun v1.0.0...` line
              .slice(0, -2)
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
              const match = /at (?:<[^>]+> \()?([^)]+):(\d+):(\d+)\)?$/.exec(stackTraceLine);
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
          if (run.exitCode) {
            expect([exitCode, signalCode]).toEqual([run.exitCode, undefined]);
          } else {
            throw new Error(prefix + "Runtime failed\n" + stdout!.toUnixString() + "\n" + stderr!.toUnixString());
          }
        }

        if (run.validate) {
          run.validate({ stderr: stderr.toUnixString(), stdout: stdout.toUnixString() });
        }

        for (let [name, expected, out] of [
          ["stdout", run.stdout, stdout],
          ["stderr", run.stderr, stderr],
        ].filter(([, v]) => v !== undefined)) {
          let result = out!.toUnixString().trim();

          // no idea why this logs. ¯\_(ツ)_/¯
          result = result.replace(/\[Event_?Loop\] enqueueTaskConcurrent\(RuntimeTranspilerStore\)\n/gi, "");
          // when the inspector runs (can be due to VSCode extension), there is
          // a bug that in debug modes the console logs extra stuff
          if (name === "stderr" && process.env.BUN_INSPECT_CONNECT_TO) {
            result = result.replace(/(?:^|\n)\/[^\n]*: CONSOLE LOG[^\n]*(\n|$)/g, "$1").trim();
          }

          if (typeof expected === "string") {
            expected = dedent(expected).trim();
            if (expected !== result) {
              console.log(`runtime failed file: ${file}`);
              console.log(`${name} output:`);
              console.log(result);
              console.log(`---`);
              console.log(`expected ${name}:`);
              console.log(expected);
              console.log(`---`);
            }
            expect(result).toBe(expected);
          } else {
            if (!expected.test(result)) {
              console.log(`runtime failed file: ${file}`);
              console.log(`${name} output:`);
              console.log(result);
              console.log(`---`);
            }
            expect(result).toMatch(expected);
          }
        }

        if (run.partialStdout !== undefined) {
          const result = stdout!.toUnixString().trim();
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
    opts = opts({ root: path.join(tempDirectory, id), getConfigRef });
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
      return ref;
    }
  }

  if (opts.todo && !FILTER) {
    it.todo(id, () => expectBundled(id, opts as any));
  } else {
    it(
      id,
      () => expectBundled(id, opts as any),
      // sourcemap code is slow
      isCI ? undefined : isDebug ? Infinity : (opts.snapshotSourceMap ? 30_000 : 5_000) * (opts.timeoutScale ?? 1),
    );
  }
  return ref;
}
itBundled.only = (id: string, opts: BundlerTestInput) => {
  const { it } = testForFile(currentFile ?? callerSourceOrigin());

  it.only(
    id,
    () => expectBundled(id, opts as any),
    // sourcemap code is slow
    isCI ? undefined : isDebug ? Infinity : (opts.snapshotSourceMap ? 30_000 : 5_000) * (opts.timeoutScale ?? 1),
  );
};

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

interface SourceMap {
  sourcesContent: string[];
  sources: string[];
}

function parseSourceMapStrSource(root: string, source_map: SourceMap, string: string) {
  const split = string.split(":");
  if (split.length < 2)
    throw new Error("Test is invalid; Invalid source location. See MappingSnapshot typedef for more info.");
  const [file, line_raw, col_raw] = split;
  const source_id = source_map.sources.findIndex(x => x.endsWith(file));
  if (source_id === -1)
    throw new Error("Test is invalid; Invalid file " + file + ". See MappingSnapshot typedef for more info.");

  const line = Number(line_raw);
  if (!Number.isInteger(line))
    throw new Error(
      "Test is invalid; Invalid source line " +
        JSON.stringify(line_raw) +
        ". See MappingSnapshot typedef for more info.",
    );

  let col = Number(col_raw);
  if (!Number.isInteger(col)) {
    const text = source_map.sourcesContent[source_id].split("\n")[line - 1];
    if (col_raw === "") {
      col = text.split("").findIndex(x => x != " " && x != "\t");
    } else if (col_raw[0] == "'" && col_raw[col_raw.length - 1] == "'") {
      col = text.indexOf(col_raw.slice(1, -1));
      if (col == -1) {
        throw new Error(
          `Test is invalid; String "${col_raw.slice(1, -1)}" is not present on line ${line} of ${path.join(root, source_map.sources[source_id])}`,
        );
      }
    } else {
      throw new Error(
        "Test is invalid; Invalid source column " +
          JSON.stringify(col_raw) +
          ". See MappingSnapshot typedef for more info.",
      );
    }
    if (col > text.length) {
      throw new Error(
        `Test is invalid; Line ${line} is only ${text.length} columns long, snapshot points to column ${col}`,
      );
    }
  }

  return { line, column: col, source: source_map.sources[source_id] };
}

function parseSourceMapStrGenerated(source_code: string, string: string) {
  const split = string.split(":");
  if (split.length != 3)
    throw new Error("Test is invalid; Invalid generated location. See MappingSnapshot typedef for more info.");
  const [line_raw, col_raw, ...match] = split;
  const line = Number(line_raw);
  if (!Number.isInteger(line))
    throw new Error(
      "Test is invalid; Invalid generated line " +
        JSON.stringify(line_raw) +
        ". See MappingSnapshot typedef for more info.",
    );

  let column = Number(col_raw);
  if (!Number.isInteger(column)) {
    throw new Error(
      "Test is invalid; Invalid generated column " +
        JSON.stringify(col_raw) +
        ". See MappingSnapshot typedef for more info.",
    );
  }

  if (match.length > 0) {
    let str = match.join(":");
    const text = source_code.split("\n")[line - 1];
    const actual = text.slice(column, column + str.length);
    if (actual !== str) {
      return { matched: false, line, column, actual, expected: str };
    }
  }

  return { matched: true, line, column };
}
