import { fileURLToPath, $ as Shell } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import ts from "typescript";

const BUN_REPO_ROOT = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES_PACKAGE_ROOT = join(BUN_REPO_ROOT, "packages", "bun-types");
const FIXTURE_SOURCE_DIR = fileURLToPath(import.meta.resolve("./fixture"));
const TSCONFIG_SOURCE_PATH = join(BUN_REPO_ROOT, "src/cli/init/tsconfig.default.json");
const BUN_TYPES_PACKAGE_JSON_PATH = join(BUN_TYPES_PACKAGE_ROOT, "package.json");
const BUN_VERSION = (process.env.BUN_VERSION ?? Bun.version ?? process.versions.bun).replace(/^.*v/, "");
const BUN_TYPES_TARBALL_NAME = `types-bun-${BUN_VERSION}.tgz`;

const { config: sourceTsconfig } = ts.readConfigFile(TSCONFIG_SOURCE_PATH, ts.sys.readFile);

const DEFAULT_COMPILER_OPTIONS = ts.parseJsonConfigFileContent(
  sourceTsconfig,
  ts.sys,
  dirname(TSCONFIG_SOURCE_PATH),
).options;

const $ = Shell.cwd(BUN_REPO_ROOT);

let TEMP_DIR: string;
let FIXTURE_DIR: string;

beforeAll(async () => {
  TEMP_DIR = await mkdtemp(join(tmpdir(), "bun-types-test-"));
  FIXTURE_DIR = join(TEMP_DIR, "fixture");

  try {
    await $`mkdir -p ${FIXTURE_DIR}`;

    await cp(FIXTURE_SOURCE_DIR, FIXTURE_DIR, { recursive: true });

    await $`
      cd ${BUN_TYPES_PACKAGE_ROOT}
      bun install

      # temp package.json with @types/bun name and version
      cp package.json package.json.backup
    `;

    const pkg = await Bun.file(BUN_TYPES_PACKAGE_JSON_PATH).json();

    await Bun.write(
      BUN_TYPES_PACKAGE_JSON_PATH,
      JSON.stringify({ ...pkg, name: "@types/bun", version: BUN_VERSION }, null, 2),
    );

    await $`
      cd ${BUN_TYPES_PACKAGE_ROOT}
      bun run build
      bun pm pack --destination ${FIXTURE_DIR}
      exit 0
      mv package.json.backup package.json

      cd ${FIXTURE_DIR}
      bun uninstall @types/bun || true
      bun add @types/bun@${BUN_TYPES_TARBALL_NAME}
      rm ${BUN_TYPES_TARBALL_NAME}
    `;
  } catch (e) {
    if (e instanceof Bun.$.ShellError) {
      console.log(e.stderr.toString());
    }

    throw e;
  }
});

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

  const glob = new Bun.Glob("**/*.{ts,tsx}").scan({
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
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => files,
    getScriptVersion: () => "0",
    getScriptSnapshot: fileName => {
      if (extraFiles) {
        const relativePath = relative(fixtureDir, fileName);
        if (relativePath in extraFiles) {
          return ts.ScriptSnapshot.fromString(extraFiles[relativePath]);
        }
      }

      if (!existsSync(fileName)) {
        return undefined;
      }

      return ts.ScriptSnapshot.fromString(readFileSync(fileName).toString());
    },
    getCurrentDirectory: () => fixtureDir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry(true, fixtureDir));

  const program = service.getProgram();
  if (!program) throw new Error("Failed to create program");

  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(program.getOptionsDiagnostics())
    .concat(program.getSyntacticDiagnostics())
    .concat(program.getConfigFileParsingDiagnostics())
    .concat(program.getDeclarationDiagnostics())
    .concat(program.emit().diagnostics)
    .map(diagnostic => ({
      category: ts.DiagnosticCategory[diagnostic.category],
      file: diagnostic.file?.fileName ? relative(fixtureDir, diagnostic.file?.fileName) : null,
      message: typeof diagnostic.messageText === "string" ? diagnostic.messageText : diagnostic.messageText.messageText,
      code: diagnostic.code,
    }));

  return {
    diagnostics,
    emptyInterfaces: checkForEmptyInterfaces(program, fixtureDir),
  };
}

function checkForEmptyInterfaces(program: ts.Program, fixtureDir: string) {
  const empties = new Set<string>();

  const checker = program.getTypeChecker();

  const anySourceFile = program.getSourceFiles()[0];
  if (!anySourceFile) {
    return empties;
  }

  const globalSymbols = checker.getSymbolsInScope(anySourceFile, ts.SymbolFlags.Interface);

  for (const symbol of globalSymbols) {
    // find only globals
    const declarations = symbol.declarations || [];

    const concernsBun = declarations.some(decl => decl.getSourceFile().fileName.includes("node_modules/@types/bun"));

    if (!concernsBun) {
      // the lion is not concerned by symbols outside of bun
      continue;
    }

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
    console.log(TEMP_DIR);

    if (Bun.env.TYPES_INTEGRATION_TEST_KEEP_TEMP_DIR === "true") {
      console.log(`Keeping temp dir ${TEMP_DIR} for debugging`);
    } else {
      await rm(TEMP_DIR, { recursive: true, force: true });
    }
  }
});

describe("@types/bun integration test", () => {
  test("checks without lib.dom.d.ts", async () => {
    const { diagnostics, emptyInterfaces } = await diagnose(FIXTURE_DIR);

    expect(emptyInterfaces).toEqual(new Set());
    expect(diagnostics).toEqual([]);
  });

  describe("test-globals reference", () => {
    const code = `
      const test_shouldBeAFunction: Function = test;
      const it_shouldBeAFunction: Function = it;
      const describe_shouldBeAFunction: Function = describe;
      const expect_shouldBeAFunction: Function = expect;
      const beforeAll_shouldBeAFunction: Function = beforeAll;
      const beforeEach_shouldBeAFunction: Function = beforeEach;
      const afterEach_shouldBeAFunction: Function = afterEach;
      const afterAll_shouldBeAFunction: Function = afterAll;
      const setDefaultTimeout_shouldBeAFunction: Function = setDefaultTimeout;
      const mock_shouldBeAFunction: Function = mock;
      const spyOn_shouldBeAFunction: Function = spyOn;
      const jest_shouldBeDefined: object = jest;
    `;

    test("checks without lib.dom.d.ts and test-globals references", async () => {
      const { diagnostics, emptyInterfaces } = await diagnose(FIXTURE_DIR, {
        files: {
          "reference-the-globals.ts": `/// <reference types="bun/test-globals" />`,
          "my-test.test.ts": code,
        },
      });

      expect(emptyInterfaces).toEqual(new Set());
      expect(diagnostics).toEqual([]);
    });

    test("test-globals FAILS when the test-globals.d.ts is not referenced", async () => {
      const { diagnostics, emptyInterfaces } = await diagnose(FIXTURE_DIR, {
        files: { "my-test.test.ts": code }, // no reference to bun/test-globals
      });

      expect(emptyInterfaces).toEqual(new Set()); // should still have no empty interfaces
      expect(diagnostics).not.toEqual([]);
    });
  });

  test("checks with lib.dom.d.ts", async () => {
    const { diagnostics, emptyInterfaces } = await diagnose(FIXTURE_DIR, {
      options: {
        lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"].map(name => `lib.${name.toLowerCase()}.d.ts`),
      },
    });

    expect(emptyInterfaces).toEqual(new Set());
    expect(diagnostics).toEqual([
      {
        category: "Error",
        file: "globals.ts",
        message: "Object literal may only specify known properties, and 'headers' does not exist in type 'string[]'.",
        code: 2353,
      },
      {
        category: "Error",
        file: "http.ts",
        message:
          "Argument of type '() => AsyncGenerator<Uint8Array<ArrayBuffer> | \"hey\", void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.",
        code: 2345,
      },
      {
        category: "Error",
        file: "http.ts",
        message:
          "Argument of type 'AsyncGenerator<Uint8Array<ArrayBuffer> | \"it works!\", void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.",
        code: 2345,
      },
      {
        category: "Error",
        file: "index.ts",
        message:
          "Argument of type 'AsyncGenerator<Uint8Array<ArrayBuffer>, void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.",
        code: 2345,
      },
      {
        category: "Error",
        file: "index.ts",
        message:
          "Argument of type '{ headers: { \"x-bun\": string; }; }' is not assignable to parameter of type 'number'.",
        code: 2345,
      },
      {
        category: "Error",
        file: "spawn.ts",
        message: "Property 'text' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "spawn.ts",
        message: "Property 'text' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "streams.ts",
        message: "No overload matches this call.",
        code: 2769,
      },
      {
        category: "Error",
        file: "streams.ts",
        message: "Property 'write' does not exist on type 'ReadableByteStreamController'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "streams.ts",
        message: "Property 'json' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "streams.ts",
        message: "Property 'bytes' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "streams.ts",
        message: "Property 'text' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "streams.ts",
        message: "Property 'blob' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Object literal may only specify known properties, and 'protocols' does not exist in type 'string[]'.",
        code: 2353,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Object literal may only specify known properties, and 'protocol' does not exist in type 'string[]'.",
        code: 2353,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Object literal may only specify known properties, and 'protocol' does not exist in type 'string[]'.",
        code: 2353,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Object literal may only specify known properties, and 'headers' does not exist in type 'string[]'.",
        code: 2353,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Object literal may only specify known properties, and 'protocols' does not exist in type 'string[]'.",
        code: 2353,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Expected 2 arguments, but got 0.",
        code: 2554,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'URL' does not exist on type 'WebSocket'. Did you mean 'url'?",
        code: 2551,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Type '\"nodebuffer\"' is not assignable to type 'BinaryType'.",
        code: 2322,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'ping' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'ping' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'ping' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'ping' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'pong' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'pong' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'pong' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'pong' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "websocket.ts",
        message: "Property 'terminate' does not exist on type 'WebSocket'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "worker.ts",
        message: "Property 'ref' does not exist on type 'Worker'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "worker.ts",
        message: "Property 'unref' does not exist on type 'Worker'.",
        code: 2339,
      },
      {
        category: "Error",
        file: "worker.ts",
        message: "Property 'threadId' does not exist on type 'Worker'.",
        code: 2339,
      },
    ]);
  });
});
