import { $ as Shell, fileURLToPath } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { makeTree } from "harness";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import ts from "typescript";

const BUN_REPO_ROOT = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES_PACKAGE_ROOT = join(BUN_REPO_ROOT, "packages", "bun-types");
const FIXTURE_SOURCE_DIR = fileURLToPath(import.meta.resolve("./fixture"));
const TSCONFIG_SOURCE_PATH = join(BUN_REPO_ROOT, "src/cli/init/tsconfig.default.json");
const BUN_TYPES_PACKAGE_JSON_PATH = join(BUN_TYPES_PACKAGE_ROOT, "package.json");
const BUN_VERSION = (process.env.BUN_VERSION ?? Bun.version ?? process.versions.bun).replace(/^.*v/, "");
const BUN_TYPES_TARBALL_NAME = `bun-types-${BUN_VERSION}.tgz`;

const { config: sourceTsconfig } = ts.readConfigFile(TSCONFIG_SOURCE_PATH, ts.sys.readFile);

const DEFAULT_COMPILER_OPTIONS = ts.parseJsonConfigFileContent(
  sourceTsconfig,
  ts.sys,
  dirname(TSCONFIG_SOURCE_PATH),
).options;

const $ = Shell.cwd(BUN_REPO_ROOT);

let TEMP_DIR: string;
let BASE_FIXTURE_DIR: string;

beforeAll(async () => {
  TEMP_DIR = await mkdtemp(join(tmpdir(), "bun-types-test-"));
  BASE_FIXTURE_DIR = join(TEMP_DIR, "base-fixture");

  try {
    await $`mkdir -p ${BASE_FIXTURE_DIR}`.quiet();

    await cp(FIXTURE_SOURCE_DIR, BASE_FIXTURE_DIR, { recursive: true });

    await $`
      cd ${BUN_TYPES_PACKAGE_ROOT}
      bun install --no-cache
      cp package.json package.json.backup
    `.quiet();

    const pkg = await Bun.file(BUN_TYPES_PACKAGE_JSON_PATH).json();

    await Bun.write(BUN_TYPES_PACKAGE_JSON_PATH, JSON.stringify({ ...pkg, version: BUN_VERSION }, null, 2));

    await $`
      cd ${BUN_TYPES_PACKAGE_ROOT}
      bun run build
      bun pm pack --destination ${BASE_FIXTURE_DIR}
      rm CLAUDE.md
      mv package.json.backup package.json

      cd ${BASE_FIXTURE_DIR}
      bun add bun-types@${BUN_TYPES_TARBALL_NAME}
      rm ${BUN_TYPES_TARBALL_NAME}
    `.quiet();

    const atTypesBunDir = join(BASE_FIXTURE_DIR, "node_modules", "@types", "bun");

    await mkdir(atTypesBunDir, { recursive: true });
    await makeTree(atTypesBunDir, {
      "index.d.ts": '/// <reference types="bun-types" />',
      "package.json": JSON.stringify({
        "private": true,
        "name": "@types/bun",
        "version": BUN_VERSION,
        "projects": ["https://bun.com"],
        "dependencies": {
          "bun-types": BUN_VERSION,
        },
      }),
    });
  } catch (e) {
    if (e instanceof Bun.$.ShellError) {
      console.log(e.stderr.toString());
    }

    throw e;
  }
});

type Diagnostic = { line: string | null; message: string; code: number };

interface TypeTestConfig {
  /** Extra tsconfig compiler options */
  options?: Partial<ts.CompilerOptions>;
  /** Specify extra files to include in the build */
  files?: Record<string, string>;
  /** Extra packages to install before type checking */
  packages?: string[];
  /** Expected empty interfaces */
  emptyInterfaces: Set<string>;
  /** Expected diagnostics - array for exact match, or function for custom assertions */
  diagnostics: Diagnostic[] | ((diagnostics: Diagnostic[]) => void);
}

let fixtureCounter = 0;

async function createIsolatedFixture(packages?: string[]): Promise<string> {
  const fixtureDir = join(TEMP_DIR, `fixture-${fixtureCounter++}`);
  await cp(BASE_FIXTURE_DIR, fixtureDir, { recursive: true });

  if (packages?.length) {
    await $`cd ${fixtureDir} && bun add ${packages}`.quiet();
  }

  return fixtureDir;
}

function typeTest(name: string, config: TypeTestConfig) {
  test(name, async () => {
    const fixtureDir = await createIsolatedFixture(config.packages);
    const { diagnostics, emptyInterfaces } = await diagnose(fixtureDir, {
      options: config.options,
      files: config.files,
    });

    expect(emptyInterfaces).toEqual(config.emptyInterfaces);

    if (typeof config.diagnostics === "function") {
      config.diagnostics(diagnostics);
    } else {
      expect(diagnostics).toEqual(config.diagnostics);
    }
  });
}

async function diagnose(
  fixtureDir: string,
  config: {
    /** Extra tsconfig compiler options */
    options?: Partial<ts.CompilerOptions>;
    /** Specify extra files to include in the build */
    files?: Record<string, string>;
  } = {},
) {
  const tsconfig = config.options ?? {};
  const extraFiles = config.files;

  const glob = new Bun.Glob("./*.{ts,tsx}").scan({
    cwd: fixtureDir,
    absolute: true,
  });

  const files = (await Array.fromAsync(glob)).filter(file => !file.includes("node_modules"));

  if (extraFiles) {
    for (const relativePath of Object.keys(extraFiles)) {
      const absolutePath = join(fixtureDir, relativePath);
      if (!files.includes(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  const options: ts.CompilerOptions = {
    ...DEFAULT_COMPILER_OPTIONS,
    ...tsconfig,

    // always check lib files for this integration test
    // (prevent https://github.com/oven-sh/bun/issues/8761 ever happening again)
    skipLibCheck: false,
    skipDefaultLibCheck: false,
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => files,
    getScriptVersion: () => "0",
    getScriptSnapshot: absolutePath => {
      if (extraFiles) {
        const relativePath = relative(fixtureDir, absolutePath);
        if (relativePath in extraFiles) {
          return ts.ScriptSnapshot.fromString(extraFiles[relativePath]);
        }
      }

      return ts.ScriptSnapshot.fromString(readFileSync(absolutePath).toString());
    },
    getCurrentDirectory: () => fixtureDir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: options => {
      const defaultLibFileName = ts.getDefaultLibFileName(options);
      return join(fixtureDir, "node_modules", "typescript", "lib", defaultLibFileName);
    },
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry(true, fixtureDir));

  const program = service.getProgram();
  if (!program) throw new Error("Failed to create program");

  function getLine(diagnostic: ts.Diagnostic) {
    if (!diagnostic.file) return null;
    if (diagnostic.start === undefined) return null;

    const lineAndCharacter = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${relative(fixtureDir, diagnostic.file.fileName)}:${lineAndCharacter.line + 1}:${lineAndCharacter.character + 1}`;
  }

  function getMessageChain(chain: string | ts.DiagnosticMessageChain): string[] {
    if (typeof chain === "string") {
      return [chain];
    }

    const messages = getMessageChain(chain.messageText);

    if (chain.next) {
      for (const next of chain.next) {
        messages.push(...getMessageChain(next));
      }
    }

    return messages;
  }

  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(program.getOptionsDiagnostics())
    .concat(program.getSyntacticDiagnostics())
    .concat(program.getConfigFileParsingDiagnostics())
    .concat(program.getDeclarationDiagnostics())
    .concat(program.emit().diagnostics)
    .map(diagnostic => ({
      line: getLine(diagnostic),
      message: getMessageChain(diagnostic.messageText).join("\n"),
      code: diagnostic.code,
    }));

  return {
    diagnostics,
    emptyInterfaces: checkForEmptyInterfaces(program),
  };
}

function checkForEmptyInterfaces(program: ts.Program) {
  const empties = new Set<string>();

  const checker = program.getTypeChecker();

  const anySourceFile = program.getSourceFiles()[0];
  if (!anySourceFile) {
    return empties;
  }

  const globalSymbols = checker.getSymbolsInScope(anySourceFile, ts.SymbolFlags.Interface);

  for (const symbol of globalSymbols) {
    // find only globals
    const declarations = symbol.declarations ?? [];

    const isGlobal = declarations.some(decl => {
      const sourceFile = decl.getSourceFile();
      let parent = decl.parent;

      while (parent && parent !== sourceFile) {
        if (ts.isModuleDeclaration(parent) || ts.isModuleBlock(parent)) {
          return false;
        }
        parent = parent.parent;
      }

      return true;
    });

    if (!isGlobal) {
      continue;
    }

    const symbolType = checker.getDeclaredTypeOfSymbol(symbol);
    const properties = checker.getPropertiesOfType(symbolType);
    const callSignatures = checker.getSignaturesOfType(symbolType, ts.SignatureKind.Call);
    const constructSignatures = checker.getSignaturesOfType(symbolType, ts.SignatureKind.Construct);
    const indexInfos = checker.getIndexInfosOfType(symbolType);

    if (
      properties.length === 0 &&
      callSignatures.length === 0 &&
      constructSignatures.length === 0 &&
      indexInfos.length === 0
    ) {
      empties.add(symbol.name);
    }
  }

  return empties;
}

afterAll(async () => {
  if (TEMP_DIR) {
    if (Bun.env.TYPES_INTEGRATION_TEST_KEEP_TEMP_DIR === "true") {
      console.log(`Keeping temp dir ${TEMP_DIR} for debugging`);
      // Write tsconfig with skipLibCheck disabled for proper type checking
      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.compilerOptions.skipLibCheck = false;
      await Bun.write(join(TEMP_DIR, "base-fixture", "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
    } else {
      await rm(TEMP_DIR, { recursive: true, force: true });
    }
  }
});

describe("@types/bun integration test", () => {
  describe("basic type checks", () => {
    typeTest("checks without lib.dom.d.ts", {
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: [],
    });
  });

  describe("Test Globals", () => {
    const code = `
      const test_shouldBeAFunction: Function = test;
      const it_shouldBeAFunction: Function = it;
      const describe_shouldBeAFunction: Function = describe;
      const expect_shouldBeAFunction: Function = expect;
      const beforeAll_shouldBeAFunction: Function = beforeAll;
      const beforeEach_shouldBeAFunction: Function = beforeEach;
      const afterEach_shouldBeAFunction: Function = afterEach;
      const afterAll_shouldBeAFunction: Function = afterAll;
      const jest_shouldBeDefined: object = jest;
      const vi_shouldBeDefined: object = vi;
    `;

    typeTest("checks without lib.dom.d.ts and test-globals references", {
      files: {
        "reference-the-globals.ts": `/// <reference types="bun-types/test-globals" />`,
        "my-test.test.ts": code,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: [],
    });

    typeTest("test-globals FAILS when the test-globals.d.ts is not referenced", {
      files: { "my-test.test.ts": code },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: [
        {
          "code": 2582,
          "line": "my-test.test.ts:2:48",
          "message":
            "Cannot find name 'test'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\`.",
        },
        {
          "code": 2582,
          "line": "my-test.test.ts:3:46",
          "message":
            "Cannot find name 'it'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\`.",
        },
        {
          "code": 2582,
          "line": "my-test.test.ts:4:52",
          "message":
            "Cannot find name 'describe'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\`.",
        },
        {
          "code": 2304,
          "line": "my-test.test.ts:5:50",
          "message": "Cannot find name 'expect'.",
        },
        {
          "code": 2304,
          "line": "my-test.test.ts:6:53",
          "message": "Cannot find name 'beforeAll'.",
        },
        {
          "code": 2304,
          "line": "my-test.test.ts:7:54",
          "message": "Cannot find name 'beforeEach'.",
        },
        {
          "code": 2304,
          "line": "my-test.test.ts:8:53",
          "message": "Cannot find name 'afterEach'.",
        },
        {
          "code": 2304,
          "line": "my-test.test.ts:9:52",
          "message": "Cannot find name 'afterAll'.",
        },
        {
          "code": 2304,
          "line": "my-test.test.ts:10:44",
          "message": "Cannot find name 'jest'.",
        },
        {
          "code": 2304,
          "line": "my-test.test.ts:11:42",
          "message": "Cannot find name 'vi'.",
        },
      ],
    });
  });

  describe("bun:bundle feature()", () => {
    typeTest("Registry augmentation restricts feature() to known flags", {
      files: {
        "registry-test.ts": `
          // Augment the Registry to define known flags
          declare module "bun:bundle" {
            interface Registry {
              features: "DEBUG" | "PREMIUM" | "BETA";
            }
          }

          import { feature } from "bun:bundle";

          // Valid flags work
          const a: boolean = feature("DEBUG");
          const b: boolean = feature("PREMIUM");
          const c: boolean = feature("BETA");

          // Invalid flags are caught at compile time
          // @ts-expect-error - "INVALID_FLAG" is not assignable to "DEBUG" | "PREMIUM" | "BETA"
          const invalid: boolean = feature("INVALID_FLAG");

          // @ts-expect-error - typos are caught
          const typo: boolean = feature("DEUBG");
        `,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: diagnostics => {
        const relevantDiagnostics = diagnostics.filter(d => d.line?.startsWith("registry-test.ts"));
        expect(relevantDiagnostics).toEqual([]);
      },
    });

    typeTest("Registry augmentation produces type errors for invalid flags", {
      files: {
        "registry-invalid-test.ts": `
          declare module "bun:bundle" {
            interface Registry {
              features: "ALLOWED_FLAG";
            }
          }

          import { feature } from "bun:bundle";

          // This should cause a type error - INVALID_FLAG is not in Registry.features
          const invalid: boolean = feature("INVALID_FLAG");
        `,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: diagnostics => {
        const relevantDiagnostics = diagnostics.filter(d => d.line?.startsWith("registry-invalid-test.ts"));
        expect(relevantDiagnostics).toEqual([
          {
            "code": 2345,
            "line": "registry-invalid-test.ts:11:44",
            "message": "Argument of type '\"INVALID_FLAG\"' is not assignable to parameter of type '\"ALLOWED_FLAG\"'.",
          },
        ]);
      },
    });

    typeTest("without Registry augmentation, feature() accepts any string", {
      files: {
        "no-registry-test.ts": `
          import { feature } from "bun:bundle";

          // Any string works when Registry.features is not defined
          const a: boolean = feature("ANY_FLAG");
          const b: boolean = feature("ANOTHER_FLAG");
          const c: boolean = feature("whatever");
        `,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: diagnostics => {
        const relevantDiagnostics = diagnostics.filter(d => d.line?.startsWith("no-registry-test.ts"));
        expect(relevantDiagnostics).toEqual([]);
      },
    });
  });

  describe("Bunland reaching for JSX", () => {
    typeTest("Bun.markdown.react() returns type compatible with React.ReactElement", {
      packages: ["@types/react", "@types/react-dom"],
      files: {
        "jsx-test.tsx": `
          import {expectType, expectAssignable} from './utilities.ts';
          import type React from "react";

          const markdownResult = Bun.markdown.react("# Hello");
          expectType(markdownResult).is<React.ReactElement<{}, string | React.JSXElementConstructor<any>>>();
          expectAssignable<React.JSX.Element>(markdownResult);

          function App() {
            return <div>{markdownResult}</div>;
          }
        `,
      },
      emptyInterfaces: expectedEmptyInterfacesThatReactDeclareWhenNoDOM,
      diagnostics: [],
    });

    typeTest("Bun.markdown.react() returns unknown if React is not installed", {
      files: {
        "jsx-test.tsx": `
          import {expectType} from './utilities.ts';
          expectType(Bun.markdown.react("# Hello")).is<unknown>();
        `,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: [],
    });
  });

  describe("core-js type compatibility", () => {
    // Tests that bun-types are compatible with core-js type patterns.
    // core-js defines ponyfill constructors that extend global built-in
    // interfaces, and these will fail with TS2430 if bun-types deviates
    // from the spec signatures.
    typeTest("bun-types signatures are compatible with core-js extends pattern", {
      files: {
        "core-js-extends-check.ts": `
          // The resolve parameter must be non-optional (required) per the spec.
          // core-js's CoreJSPromiseConstructor extends PromiseConstructor with
          // this signature — if bun-types makes resolve optional, this fails with TS2430.
          interface StrictPromiseWithResolvers<T> {
            promise: Promise<T>;
            resolve: (value: T | PromiseLike<T>) => void;
            reject: (reason?: any) => void;
          }
          interface StrictPromiseConstructor extends PromiseConstructor {
            withResolvers<T>(): StrictPromiseWithResolvers<T>;
          }

          // ArrayBuffer.resize must return void per the spec.
          // If bun-types returns ArrayBuffer instead, this fails with TS2430.
          interface StrictArrayBuffer extends ArrayBuffer {
            resize(newByteLength?: number): void;
          }
        `,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: diagnostics => {
        const relevantDiagnostics = diagnostics.filter(d => d.line?.startsWith("core-js-extends-check.ts"));
        expect(relevantDiagnostics).toEqual([]);
      },
    });

    // Intentionally fetches type definitions from the upstream core-js v4-types
    // branch at test time rather than vendoring them, so we always test against
    // the latest core-js types and catch new incompatibilities early.
    // https://github.com/zloirock/core-js/tree/v4-types/packages/core-js-types
    const CORE_JS_TYPES_TREE_API = "https://api.github.com/repos/zloirock/core-js/git/trees/v4-types?recursive=1";
    const CORE_JS_TYPES_RAW_BASE = "https://raw.githubusercontent.com/zloirock/core-js/v4-types";
    const CORE_JS_TYPES_PREFIX = "packages/core-js-types/src/base/";

    async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url);
          if (response.ok) return response;
          if (i === retries - 1) throw new Error(`Failed to fetch ${url}: ${response.status}`);
        } catch (error) {
          if (i === retries - 1) throw error;
        }
        await Bun.sleep(1000 * (i + 1));
      }
      throw new Error("unreachable");
    }

    test("no conflicts with upstream core-js-types", async () => {
      // Discover all non-pure .d.ts files from the core-js-types package
      const treeResponse = await fetchWithRetry(CORE_JS_TYPES_TREE_API);
      const tree: { tree: { path: string; type: string }[] } = await treeResponse.json();

      const typesFiles = tree.tree
        .filter(
          entry =>
            entry.type === "blob" &&
            entry.path.startsWith(CORE_JS_TYPES_PREFIX) &&
            entry.path.endsWith(".d.ts") &&
            !entry.path.includes("/pure/"),
        )
        .map(entry => entry.path.slice(CORE_JS_TYPES_PREFIX.length));

      if (typesFiles.length === 0) throw new Error("No core-js type files found — API may have changed");

      // Fetch all files in parallel
      const files: Record<string, string> = {};
      await Promise.all(
        typesFiles.map(async file => {
          const response = await fetchWithRetry(`${CORE_JS_TYPES_RAW_BASE}/${CORE_JS_TYPES_PREFIX}${file}`);
          files[`core-js-types/${file}`] = await response.text();
        }),
      );

      files["core-js-compat.ts"] =
        typesFiles.map(file => `/// <reference path="core-js-types/${file}" />`).join("\n") +
        `
        // Verify usage works with both bun-types and core-js-types loaded
        const buf = new ArrayBuffer(1024, { maxByteLength: 2048 });
        buf.resize(2048);

        const { promise, resolve, reject } = Promise.withResolvers<string>();
        resolve("hello");
      `;

      const fixtureDir = await createIsolatedFixture();
      const { diagnostics, emptyInterfaces } = await diagnose(fixtureDir, { files });

      // core-js declares some DOM interfaces (Element, Node, etc.) for
      // iterable-dom-collections — these are empty without lib.dom.d.ts.
      // Just verify we're a superset of the base expected empty interfaces.
      for (const name of expectedEmptyInterfacesWhenNoDOM) {
        expect(emptyInterfaces).toContain(name);
      }

      // Filter out core-js internal issues (missing cross-references, circular types)
      // that aren't caused by bun-types incompatibility.
      const ignoredCodes = new Set([
        2688, // "Cannot find type definition file" — core-js cross-references between its own files
        2502, // "referenced directly or indirectly in its own type annotation" — circular refs in core-js
      ]);
      const relevantDiagnostics = diagnostics.filter(
        d =>
          !ignoredCodes.has(d.code) &&
          (d.line === null || d.line.startsWith("core-js-compat.ts") || d.line.startsWith("core-js-types/")),
      );
      expect(relevantDiagnostics).toEqual([]);
    });
  });

  describe("lib configuration", () => {
    typeTest("checks with no lib at all", {
      options: {
        lib: [],
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: [],
    });

    typeTest("fails with types: [] and no jsx", {
      options: {
        lib: [],
        types: [],
        jsx: ts.JsxEmit.None,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: [],
    });

    typeTest("checks with lib.dom.d.ts", {
      options: {
        lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"].map(name => `lib.${name.toLowerCase()}.d.ts`),
      },
      emptyInterfaces: new Set([
        "ThisType",
        "RTCAnswerOptions",
        "RTCOfferAnswerOptions",
        "RTCSetParameterOptions",
        "EXT_color_buffer_float",
        "EXT_float_blend",
        "EXT_frag_depth",
        "EXT_shader_texture_lod",
        "FragmentDirective",
        "MediaSourceHandle",
        "OES_element_index_uint",
        "OES_fbo_render_mipmap",
        "OES_texture_float",
        "OES_texture_float_linear",
        "OES_texture_half_float_linear",
        "PeriodicWave",
        "RTCRtpScriptTransform",
        "WebGLBuffer",
        "WebGLFramebuffer",
        "WebGLProgram",
        "WebGLQuery",
        "WebGLRenderbuffer",
        "WebGLSampler",
        "WebGLShader",
        "WebGLSync",
        "WebGLTexture",
        "WebGLTransformFeedback",
        "WebGLUniformLocation",
        "WebGLVertexArrayObject",
        "WebGLVertexArrayObjectOES",
      ]),
      diagnostics: [
        {
          code: 2322,
          line: "24154.ts:11:3",
          message:
            "Type 'Blob' is not assignable to type 'import(\"node:buffer\").Blob'.\nThe types returned by 'stream()' are incompatible between these types.\nType 'ReadableStream<Uint8Array<ArrayBuffer>>' is missing the following properties from type 'ReadableStream<NonSharedUint8Array>': blob, text, bytes, json",
        },
        {
          code: 2769,
          line: "fetch.ts:25:32",
          message:
            "No overload matches this call.\nOverload 1 of 3, '(input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>', gave the following error.\nType 'AsyncGenerator<\"chunk1\" | \"chunk2\", void, unknown>' is not assignable to type 'BodyInit | null | undefined'.\nType 'AsyncGenerator<\"chunk1\" | \"chunk2\", void, unknown>' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.\nOverload 2 of 3, '(input: string | Request | URL, init?: BunFetchRequestInit | undefined): Promise<Response>', gave the following error.\nType 'AsyncGenerator<\"chunk1\" | \"chunk2\", void, unknown>' is not assignable to type 'BodyInit | null | undefined'.\nType 'AsyncGenerator<\"chunk1\" | \"chunk2\", void, unknown>' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.\nOverload 3 of 3, '(input: RequestInfo | URL, init?: RequestInit | undefined): Promise<Response>', gave the following error.\nType 'AsyncGenerator<\"chunk1\" | \"chunk2\", void, unknown>' is not assignable to type 'BodyInit | null | undefined'.\nType 'AsyncGenerator<\"chunk1\" | \"chunk2\", void, unknown>' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.",
        },
        {
          code: 2769,
          line: "fetch.ts:33:32",
          message:
            "No overload matches this call.\nOverload 1 of 3, '(input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>', gave the following error.\nType '{ [Symbol.asyncIterator](): AsyncGenerator<\"data1\" | \"data2\", void, unknown>; }' is not assignable to type 'BodyInit | null | undefined'.\nType '{ [Symbol.asyncIterator](): AsyncGenerator<\"data1\" | \"data2\", void, unknown>; }' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.\nOverload 2 of 3, '(input: string | Request | URL, init?: BunFetchRequestInit | undefined): Promise<Response>', gave the following error.\nType '{ [Symbol.asyncIterator](): AsyncGenerator<\"data1\" | \"data2\", void, unknown>; }' is not assignable to type 'BodyInit | null | undefined'.\nType '{ [Symbol.asyncIterator](): AsyncGenerator<\"data1\" | \"data2\", void, unknown>; }' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.\nOverload 3 of 3, '(input: RequestInfo | URL, init?: RequestInit | undefined): Promise<Response>', gave the following error.\nType '{ [Symbol.asyncIterator](): AsyncGenerator<\"data1\" | \"data2\", void, unknown>; }' is not assignable to type 'BodyInit | null | undefined'.\nType '{ [Symbol.asyncIterator](): AsyncGenerator<\"data1\" | \"data2\", void, unknown>; }' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.",
        },
        {
          code: 2769,
          line: "fetch.ts:168:34",
          message:
            "No overload matches this call.\nOverload 1 of 3, '(input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>', gave the following error.\nType 'SharedArrayBuffer' is not assignable to type 'BodyInit | null | undefined'.\nType 'SharedArrayBuffer' is missing the following properties from type 'ArrayBuffer': resizable, resize, detached, transfer, transferToFixedLength\nOverload 2 of 3, '(input: string | Request | URL, init?: BunFetchRequestInit | undefined): Promise<Response>', gave the following error.\nType 'SharedArrayBuffer' is not assignable to type 'BodyInit | null | undefined'.\nType 'SharedArrayBuffer' is missing the following properties from type 'ArrayBuffer': resizable, resize, detached, transfer, transferToFixedLength\nOverload 3 of 3, '(input: RequestInfo | URL, init?: RequestInit | undefined): Promise<Response>', gave the following error.\nType 'SharedArrayBuffer' is not assignable to type 'BodyInit | null | undefined'.\nType 'SharedArrayBuffer' is missing the following properties from type 'ArrayBuffer': resizable, resize, detached, transfer, transferToFixedLength",
        },
        {
          code: 2353,
          line: "globals.ts:307:5",
          message: "Object literal may only specify known properties, and 'headers' does not exist in type 'string[]'.",
        },
        {
          code: 2345,
          line: "http.ts:43:24",
          message:
            "Argument of type '() => AsyncGenerator<Uint8Array<ArrayBuffer> | \"hey\", void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.",
        },
        {
          code: 2345,
          line: "http.ts:55:24",
          message:
            "Argument of type 'AsyncGenerator<Uint8Array<ArrayBuffer> | \"it works!\", void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.\nType 'AsyncGenerator<Uint8Array<ArrayBuffer> | \"it works!\", void, unknown>' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.",
        },
        {
          code: 2345,
          line: "index.ts:196:14",
          message:
            "Argument of type 'AsyncGenerator<Uint8Array<ArrayBuffer>, void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.\nType 'AsyncGenerator<Uint8Array<ArrayBuffer>, void, unknown>' is missing the following properties from type 'ReadableStream<any>': locked, cancel, getReader, pipeThrough, and 3 more.",
        },
        {
          code: 2345,
          line: "index.ts:322:29",
          message:
            "Argument of type '{ headers: { \"x-bun\": string; }; }' is not assignable to parameter of type 'number'.",
        },
        {
          code: 2339,
          line: "spawn.ts:62:38",
          message: "Property 'text' does not exist on type 'ReadableStream<Uint8Array<ArrayBuffer>>'.",
        },
        {
          code: 2339,
          line: "spawn.ts:107:38",
          message: "Property 'text' does not exist on type 'ReadableStream<Uint8Array<ArrayBuffer>>'.",
        },
        {
          code: 2769,
          line: "streams.ts:18:3",
          message:
            "No overload matches this call.\nOverload 1 of 3, '(underlyingSource: UnderlyingByteSource, strategy?: { highWaterMark?: number | undefined; } | undefined): ReadableStream<Uint8Array<ArrayBuffer>>', gave the following error.\nType '\"direct\"' is not assignable to type '\"bytes\"'.",
        },
        {
          code: 2339,
          line: "streams.ts:20:16",
          message: "Property 'write' does not exist on type 'ReadableByteStreamController'.",
        },
        {
          code: 2339,
          line: "streams.ts:46:19",
          message: "Property 'json' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        },
        {
          code: 2339,
          line: "streams.ts:47:19",
          message: "Property 'bytes' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        },
        {
          code: 2339,
          line: "streams.ts:48:19",
          message: "Property 'text' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        },
        {
          code: 2339,
          line: "streams.ts:49:19",
          message: "Property 'blob' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        },
        {
          code: 2345,
          line: "streams.ts:63:66",
          message: "Argument of type '\"brotli\"' is not assignable to parameter of type 'CompressionFormat'.",
        },
        {
          code: 2345,
          line: "streams.ts:63:113",
          message: "Argument of type '\"brotli\"' is not assignable to parameter of type 'CompressionFormat'.",
        },
        {
          code: 2345,
          line: "streams.ts:64:66",
          message: "Argument of type '\"zstd\"' is not assignable to parameter of type 'CompressionFormat'.",
        },
        {
          code: 2345,
          line: "streams.ts:64:111",
          message: "Argument of type '\"zstd\"' is not assignable to parameter of type 'CompressionFormat'.",
        },
        {
          code: 2353,
          line: "websocket.ts:25:5",
          message:
            "Object literal may only specify known properties, and 'protocols' does not exist in type 'string[]'.",
        },
        {
          code: 2353,
          line: "websocket.ts:30:5",
          message:
            "Object literal may only specify known properties, and 'protocol' does not exist in type 'string[]'.",
        },
        {
          code: 2353,
          line: "websocket.ts:35:5",
          message:
            "Object literal may only specify known properties, and 'protocol' does not exist in type 'string[]'.",
        },
        {
          code: 2353,
          line: "websocket.ts:43:5",
          message: "Object literal may only specify known properties, and 'headers' does not exist in type 'string[]'.",
        },
        {
          code: 2353,
          line: "websocket.ts:51:5",
          message:
            "Object literal may only specify known properties, and 'protocols' does not exist in type 'string[]'.",
        },
        {
          code: 2554,
          line: "websocket.ts:185:29",
          message: "Expected 2 arguments, but got 0.",
        },
        {
          code: 2551,
          line: "websocket.ts:192:17",
          message: "Property 'URL' does not exist on type 'WebSocket'. Did you mean 'url'?",
        },
        {
          code: 2322,
          line: "websocket.ts:196:3",
          message: "Type '\"nodebuffer\"' is not assignable to type 'BinaryType'.",
        },
        {
          code: 2339,
          line: "websocket.ts:242:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:245:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:249:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:253:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:256:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:259:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:263:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:267:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:270:6",
          message: "Property 'terminate' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "worker.ts:23:11",
          message: "Property 'ref' does not exist on type 'Worker'.",
        },
        {
          code: 2339,
          line: "worker.ts:24:11",
          message: "Property 'unref' does not exist on type 'Worker'.",
        },
        {
          code: 2339,
          line: "worker.ts:25:11",
          message: "Property 'threadId' does not exist on type 'Worker'.",
        },
      ],
    });
  });
});

const expectedEmptyInterfacesWhenNoDOM = new Set(["ThisType"]);

const expectedEmptyInterfacesThatReactDeclareWhenNoDOM = new Set([
  ...expectedEmptyInterfacesWhenNoDOM,
  "Document",
  "DataTransfer",
  "StyleMedia",
  "Element",
  "DocumentFragment",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLAreaElement",
  "HTMLAudioElement",
  "HTMLBaseElement",
  "HTMLBodyElement",
  "HTMLBRElement",
  "HTMLButtonElement",
  "HTMLCanvasElement",
  "HTMLDataElement",
  "HTMLDataListElement",
  "HTMLDetailsElement",
  "HTMLDialogElement",
  "HTMLDivElement",
  "HTMLDListElement",
  "HTMLEmbedElement",
  "HTMLFieldSetElement",
  "HTMLFormElement",
  "HTMLHeadingElement",
  "HTMLHeadElement",
  "HTMLHRElement",
  "HTMLHtmlElement",
  "HTMLIFrameElement",
  "HTMLImageElement",
  "HTMLInputElement",
  "HTMLModElement",
  "HTMLLabelElement",
  "HTMLLegendElement",
  "HTMLLIElement",
  "HTMLLinkElement",
  "HTMLMapElement",
  "HTMLMetaElement",
  "HTMLMeterElement",
  "HTMLObjectElement",
  "HTMLOListElement",
  "HTMLOptGroupElement",
  "HTMLOptionElement",
  "HTMLOutputElement",
  "HTMLParagraphElement",
  "HTMLParamElement",
  "HTMLPreElement",
  "HTMLProgressElement",
  "HTMLQuoteElement",
  "HTMLSlotElement",
  "HTMLScriptElement",
  "HTMLSelectElement",
  "HTMLSourceElement",
  "HTMLSpanElement",
  "HTMLStyleElement",
  "HTMLTableElement",
  "HTMLTableColElement",
  "HTMLTableDataCellElement",
  "HTMLTableHeaderCellElement",
  "HTMLTableRowElement",
  "HTMLTableSectionElement",
  "HTMLTemplateElement",
  "HTMLTextAreaElement",
  "HTMLTimeElement",
  "HTMLTitleElement",
  "HTMLTrackElement",
  "HTMLUListElement",
  "HTMLVideoElement",
  "HTMLWebViewElement",
  "SVGElement",
  "SVGSVGElement",
  "SVGCircleElement",
  "SVGClipPathElement",
  "SVGDefsElement",
  "SVGDescElement",
  "SVGEllipseElement",
  "SVGFEBlendElement",
  "SVGFEColorMatrixElement",
  "SVGFEComponentTransferElement",
  "SVGFECompositeElement",
  "SVGFEConvolveMatrixElement",
  "SVGFEDiffuseLightingElement",
  "SVGFEDisplacementMapElement",
  "SVGFEDistantLightElement",
  "SVGFEDropShadowElement",
  "SVGFEFloodElement",
  "SVGFEFuncAElement",
  "SVGFEFuncBElement",
  "SVGFEFuncGElement",
  "SVGFEFuncRElement",
  "SVGFEGaussianBlurElement",
  "SVGFEImageElement",
  "SVGFEMergeElement",
  "SVGFEMergeNodeElement",
  "SVGFEMorphologyElement",
  "SVGFEOffsetElement",
  "SVGFEPointLightElement",
  "SVGFESpecularLightingElement",
  "SVGFESpotLightElement",
  "SVGFETileElement",
  "SVGFETurbulenceElement",
  "SVGFilterElement",
  "SVGForeignObjectElement",
  "SVGGElement",
  "SVGImageElement",
  "SVGLineElement",
  "SVGLinearGradientElement",
  "SVGMarkerElement",
  "SVGMaskElement",
  "SVGMetadataElement",
  "SVGPathElement",
  "SVGPatternElement",
  "SVGPolygonElement",
  "SVGPolylineElement",
  "SVGRadialGradientElement",
  "SVGRectElement",
  "SVGSetElement",
  "SVGStopElement",
  "SVGSwitchElement",
  "SVGSymbolElement",
  "SVGTextElement",
  "SVGTextPathElement",
  "SVGTSpanElement",
  "SVGUseElement",
  "SVGViewElement",
  "Text",
  "TouchList",
  "WebGLRenderingContext",
  "WebGL2RenderingContext",
  "TrustedHTML",
  "MediaStream",
  "MediaSource",
]);
