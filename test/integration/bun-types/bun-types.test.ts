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
    `.quiet();

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
    `.quiet();
  } catch (e) {
    if (e instanceof Bun.$.ShellError) {
      console.log(e.stderr.toString());
    }

    throw e;
  }
});

async function diagnose(fixtureDir: string, tsconfig: Partial<ts.CompilerOptions>) {
  const glob = new Bun.Glob("**/*.{ts,tsx}").scan({
    cwd: fixtureDir,
    absolute: true,
  });

  const files = (await Array.fromAsync(glob)).filter(file => !file.includes("node_modules"));

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

  const emptyInterfaceDiagnostics = checkForEmptyInterfaces(program, fixtureDir);

  return diagnostics.concat(emptyInterfaceDiagnostics);
}

function checkForEmptyInterfaces(program: ts.Program, fixtureDir: string) {
  const diagnostics: Array<{
    category: string;
    file: string | null;
    message: string;
    code: number;
  }> = [];

  const checker = program.getTypeChecker();

  const globalSourceFile = program
    .getSourceFiles()
    .find(sf => sf.fileName.includes("bun-types") && sf.fileName.endsWith("globals.d.ts"));

  if (!globalSourceFile) {
    return diagnostics;
  }

  const globalInterfaceNames = new Set<string>();

  ts.forEachChild(globalSourceFile, function visit(node) {
    if (ts.isInterfaceDeclaration(node) && !ts.isNodeDescendantOf(node, ts.isModuleDeclaration)) {
      globalInterfaceNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  });

  for (const interfaceName of globalInterfaceNames) {
    const globalSymbol = checker.resolveName(interfaceName, undefined, ts.SymbolFlags.Interface, false);

    if (globalSymbol) {
      const globalType = checker.getDeclaredTypeOfSymbol(globalSymbol);
      const properties = checker.getPropertiesOfType(globalType);
      const callSignatures = checker.getSignaturesOfType(globalType, ts.SignatureKind.Call);
      const constructSignatures = checker.getSignaturesOfType(globalType, ts.SignatureKind.Construct);
      const indexInfos = checker.getIndexInfosOfType(globalType);

      if (
        properties.length === 0 &&
        callSignatures.length === 0 &&
        constructSignatures.length === 0 &&
        indexInfos.length === 0
      ) {
        diagnostics.push({
          category: "Error",
          file: null,
          message: `Global interface '${interfaceName}' has no properties, call signatures, construct signatures, or index signatures after type resolution. This interface needs to either have members defined or extend a conditional type that provides fallback implementations.`,
          code: 9999,
        });
      }
    }
  }

  return diagnostics;
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
    const diagnostics = await diagnose(FIXTURE_DIR, {});

    expect(diagnostics).toEqual([]);
  });

  test("checks with lib.dom.d.ts", async () => {
    const diagnostics = await diagnose(FIXTURE_DIR, {
      lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"].map(name => `lib.${name.toLowerCase()}.d.ts`),
    });

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
