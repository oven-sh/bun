import { $ as Shell, fileURLToPath } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, makeTree } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

import ts from "typescript";

// beforeAll packs bun-types and installs it from the registry, and each case below copies
// a fixture and type-checks it for several seconds, so everything here outlives the 5s
// default that a plain `bun test <this file>` (CLAUDE.md, .github/workflows/bun-types.yml)
// runs with; only the CI runner passes a larger --timeout. This call has to precede the
// registrations: each hook/test captures the default when it is declared.
setDefaultTimeout(1000 * 60 * 2);

const BUN_REPO_ROOT = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES_PACKAGE_ROOT = join(BUN_REPO_ROOT, "packages", "bun-types");
const FIXTURE_SOURCE_DIR = fileURLToPath(import.meta.resolve("./fixture"));
const TSCONFIG_SOURCE_PATH = join(BUN_REPO_ROOT, "src/cli/init/tsconfig.default.json");
const BUN_VERSION = (process.env.BUN_VERSION ?? Bun.version ?? process.versions.bun).replace(/^.*v/, "");
const BUN_TYPES_TARBALL_NAME = `bun-types-${BUN_VERSION}.tgz`;

const { config: sourceTsconfig } = ts.readConfigFile(TSCONFIG_SOURCE_PATH, ts.sys.readFile);

const DEFAULT_COMPILER_OPTIONS = ts.parseJsonConfigFileContent(
  sourceTsconfig,
  ts.sys,
  dirname(TSCONFIG_SOURCE_PATH),
).options;

const $ = Shell.cwd(BUN_REPO_ROOT);

// What `bun run build` generates. beforeAll builds into a copy of the package under
// TEMP_DIR, so none of this may change in the checkout (it used to be built in place,
// with package.json restored afterwards, which left the tree dirty whenever beforeAll
// was interrupted).
function snapshotBunTypesCheckout() {
  return {
    "package.json": readFileSync(join(BUN_TYPES_PACKAGE_ROOT, "package.json"), "utf8"),
    "CLAUDE.md": existsSync(join(BUN_TYPES_PACKAGE_ROOT, "CLAUDE.md")),
    "docs": existsSync(join(BUN_TYPES_PACKAGE_ROOT, "docs")),
  };
}

const bunTypesCheckoutBeforeSetup = snapshotBunTypesCheckout();

let TEMP_DIR: string;
let BASE_FIXTURE_DIR: string;

beforeAll(async () => {
  TEMP_DIR = await mkdtemp(join(tmpdir(), "bun-types-test-"));
  BASE_FIXTURE_DIR = join(TEMP_DIR, "base-fixture");
  const bunTypesBuildDir = join(TEMP_DIR, "bun-types");

  try {
    await cp(FIXTURE_SOURCE_DIR, BASE_FIXTURE_DIR, { recursive: true });
    await cp(BUN_TYPES_PACKAGE_ROOT, bunTypesBuildDir, {
      recursive: true,
      filter: source => basename(source) !== "node_modules",
    });

    await $`cd ${BUN_TYPES_PACKAGE_ROOT} && BUN_VERSION=${BUN_VERSION} bun run build ${bunTypesBuildDir}`.quiet();
    await $`cd ${bunTypesBuildDir} && bun pm pack --destination ${BASE_FIXTURE_DIR}`.quiet();
    await $`cd ${BASE_FIXTURE_DIR} && bun add bun-types@${BUN_TYPES_TARBALL_NAME} && rm ${BUN_TYPES_TARBALL_NAME}`.quiet();

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
  // This file only tests the bun-types .d.ts, not bun's own code. Driving the
  // TypeScript LanguageService in-process under a debug build is ~40x slower,
  // so run the type-checking cases on release builds only.
  test.skipIf(isDebug)(name, async () => {
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
    // Resolve lib.*.d.ts from the same TypeScript install that provides this compiler API.
    // typescript@7 (native) no longer ships lib/lib.*.d.ts in its npm package, so the
    // fixture's `typescript` dep cannot be used as the lib source.
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
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
  test("building and packing bun-types leaves packages/bun-types untouched", () => {
    expect(snapshotBunTypesCheckout()).toEqual(bunTypesCheckoutBeforeSetup);
  });

  test("packed bun-types includes CLAUDE.md", async () => {
    const claude = Bun.file(join(BASE_FIXTURE_DIR, "node_modules", "bun-types", "CLAUDE.md"));
    expect(await claude.exists()).toBe(true);
    expect((await claude.text()).length).toBeGreaterThan(0);
  });

  describe("basic type checks", () => {
    typeTest("checks without lib.dom.d.ts", {
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: [],
    });
  });

  // The fixture depends on typescript@latest, so this is the current stable release:
  // since 7.0 that is the native (Go-based) compiler, which does not expose a JS
  // compiler API, so unlike the tests above we write a real tsconfig and spawn the CLI.
  // https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/
  describe("TypeScript latest", () => {
    test.skipIf(isDebug)("checks without lib.dom.d.ts", async () => {
      const fixtureDir = await createIsolatedFixture();

      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.compilerOptions.skipLibCheck = false;
      tsconfig.include = ["*.ts", "*.tsx"];
      await Bun.write(join(fixtureDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(fixtureDir, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
        env: bunEnv,
        cwd: fixtureDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.trim()).toBe("");
      expect(stdout.trim()).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  // TypeScript 7.1 resolves `import x from "./f" with { type: "text" }` against
  // `declare module "*" with { type: "text" }` (microsoft/TypeScript#63931).
  // bun-types ships those declarations in ts7.1/, reached through
  // package.json#typesVersions, so they are invisible to the compilers above.
  // This run checks the whole fixture through that entry point, plus the
  // fixture/ts7.1 files that only that compiler can type.
  // `>=7.1.0-0` takes the nightly until a 7.1 release exists, then the release.
  describe("TypeScript 7.1", () => {
    test.skipIf(isDebug)("checks the fixture and import attributes through ts7.1/index.d.ts", async () => {
      const fixtureDir = await createIsolatedFixture(["typescript@>=7.1.0-0"]);

      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.compilerOptions.skipLibCheck = false;
      tsconfig.include = ["*.ts", "*.tsx", "ts7.1/*.ts"];
      await Bun.write(join(fixtureDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(fixtureDir, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
        env: bunEnv,
        cwd: fixtureDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.trim()).toBe("");
      expect(stdout.trim()).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  // Runs on debug builds too: spawning tsc over a single file is cheap,
  // unlike the in-process LanguageService runs above.
  describe("Bun.mmap", () => {
    test("MMapOptions accepts offset and size", async () => {
      const checkDir = join(TEMP_DIR, "mmap-options-check");
      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.include = ["mmap-options.ts"];
      tsconfig.compilerOptions.typeRoots = [join(BASE_FIXTURE_DIR, "node_modules", "@types")];
      await mkdir(checkDir, { recursive: true });
      await makeTree(checkDir, {
        "tsconfig.json": JSON.stringify(tsconfig, null, 2),
        "mmap-options.ts": `const view = Bun.mmap("./data.bin", { shared: true, sync: false, offset: 4096, size: 1024 });
           view satisfies Uint8Array<ArrayBuffer>;
           Bun.mmap("./data.bin", { offset: 4096 }) satisfies Uint8Array<ArrayBuffer>;
           Bun.mmap("./data.bin", { size: 1024 }) satisfies Uint8Array<ArrayBuffer>;`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(BASE_FIXTURE_DIR, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
        env: bunEnv,
        cwd: checkDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.trim()).toBe("");
      expect(stdout.trim()).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  // Runs on debug builds too, same as the Bun.mmap block above.
  describe("TextDecoder", () => {
    test("accepts the encoding labels the runtime supports", async () => {
      const checkDir = join(TEMP_DIR, "text-decoder-encoding-check");
      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.include = ["text-decoder-encodings.ts"];
      tsconfig.compilerOptions.typeRoots = [join(BASE_FIXTURE_DIR, "node_modules", "@types")];
      await mkdir(checkDir, { recursive: true });
      await makeTree(checkDir, {
        "tsconfig.json": JSON.stringify(tsconfig, null, 2),
        "text-decoder-encodings.ts": `new TextDecoder("windows-1251");
           new TextDecoder("shift_jis");
           new TextDecoder("utf8");
           new TextDecoder("latin1");
           new TextDecoder("gb18030", { fatal: true, ignoreBOM: true });
           // @ts-expect-error - the TextDecoder constructor rejects the replacement encoding
           "hz-gb-2312" satisfies Bun.Encoding;
           // @ts-expect-error - not a label the Encoding Standard defines
           "utf-99" satisfies Bun.Encoding;`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(BASE_FIXTURE_DIR, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
        env: bunEnv,
        cwd: checkDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.trim()).toBe("");
      expect(stdout.trim()).toBe("");
      expect(exitCode).toBe(0);
    });

    // tsc cannot read the runtime's label table in
    // src/runtime/webcore/EncodingLabel.rs, so the fixture carries a literal
    // copy. This check ties that copy to the running binary: every fixture
    // label must construct, and the replacement labels must throw.
    test("the fixture label table matches the runtime", () => {
      const fixture = readFileSync(join(FIXTURE_SOURCE_DIR, "text-encode-decoder.ts"), "utf8");
      const arrayStart = fixture.indexOf("const labels = [");
      const arrayEnd = fixture.indexOf("] as const;", arrayStart);
      expect(arrayStart).toBeGreaterThan(-1);
      expect(arrayEnd).toBeGreaterThan(arrayStart);

      const labels = [...fixture.slice(arrayStart, arrayEnd).matchAll(/"([^"]+)"/g)].map(m => m[1]);
      expect(labels).toHaveLength(222);
      expect(new Set(labels).size).toBe(labels.length);

      const rejected = labels.filter(label => {
        try {
          new TextDecoder(label as Bun.Encoding);
          return false;
        } catch {
          return true;
        }
      });
      expect(rejected).toEqual([]);

      for (const label of [
        "csiso2022kr",
        "hz-gb-2312",
        "iso-2022-cn",
        "iso-2022-cn-ext",
        "iso-2022-kr",
        "replacement",
      ]) {
        expect(() => new TextDecoder(label as Bun.Encoding)).toThrow(RangeError);
      }
    });
  });

  // Runs on debug builds too, same as the Bun.mmap block above.
  describe("Event and EventTarget", () => {
    async function checkEventFixture(name: string, lib: string[], source: string) {
      const checkDir = join(TEMP_DIR, name);
      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.include = ["event-check.ts"];
      tsconfig.compilerOptions.lib = lib;
      tsconfig.compilerOptions.typeRoots = [join(BASE_FIXTURE_DIR, "node_modules", "@types")];
      await mkdir(checkDir, { recursive: true });
      await makeTree(checkDir, {
        "tsconfig.json": JSON.stringify(tsconfig, null, 2),
        "event-check.ts": source,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(BASE_FIXTURE_DIR, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
        env: bunEnv,
        cwd: checkDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.trim()).toBe("");
      expect(stdout.trim()).toBe("");
      expect(exitCode).toBe(0);
    }

    test("lib.dom's composedPath() declaration wins when lib.dom is loaded", async () => {
      await checkEventFixture(
        "event-lib-dom-check",
        ["ESNext", "DOM"],
        `// lib.dom declares composedPath(): EventTarget[]. The Node-style tuple
         // declaration must not merge into it (#40574).
         declare const fullPath: EventTarget[];
         export const composed: ReturnType<Event["composedPath"]> = fullPath;`,
      );
    });

    test("the Node-style composedPath() tuple applies without lib.dom", async () => {
      await checkEventFixture(
        "event-no-lib-dom-check",
        ["ESNext"],
        `declare const e: Event;
         export const composed: [EventTarget?] = e.composedPath();`,
      );
    });
  });

  // Also runs on debug builds: spawned tsc over a single file, like the
  // Bun.mmap check above. @types/node@24 declares `off`/`removeListener` only
  // on EventEmitter, not on `Process`, so the `memoryPressure` overloads in
  // overrides.d.ts used to hide the inherited signatures and reject every
  // other event name (#40003). @types/node >= 26 declares them on `Process`
  // directly, which masks the bug, so this check pins @types/node@24 instead
  // of reusing the base fixture.
  describe("process event methods with @types/node@24", () => {
    test("removeListener and off accept other event names", async () => {
      const checkDir = join(TEMP_DIR, "types-node-24-check");
      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.include = ["index.ts"];
      await mkdir(checkDir, { recursive: true });
      await makeTree(checkDir, {
        "package.json": JSON.stringify({ name: "types-node-24-check", private: true }),
        "tsconfig.json": JSON.stringify(tsconfig, null, 2),
        "index.ts": `process.removeListener("SIGINT", () => {});
           process.off("unhandledRejection", () => {});
           process.removeListener("memoryPressure", () => {});
           process.on("memoryPressure", level => {
             level satisfies "warning" | "critical";
           });`,
      });
      await $`cd ${checkDir} && bun add @types/node@24`.quiet();
      await cp(join(BASE_FIXTURE_DIR, "node_modules", "bun-types"), join(checkDir, "node_modules", "bun-types"), {
        recursive: true,
      });
      await cp(
        join(BASE_FIXTURE_DIR, "node_modules", "@types", "bun"),
        join(checkDir, "node_modules", "@types", "bun"),
        { recursive: true },
      );

      // Guard against resolution drift silently checking the wrong major.
      const nodeTypesPkg = await Bun.file(join(checkDir, "node_modules", "@types", "node", "package.json")).json();
      expect(nodeTypesPkg.version).toStartWith("24.");

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(BASE_FIXTURE_DIR, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
        env: bunEnv,
        cwd: checkDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.trim()).toBe("");
      expect(stdout.trim()).toBe("");
      expect(exitCode).toBe(0);
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
          "code": 2593,
          "line": "my-test.test.ts:2:48",
          "message":
            "Cannot find name 'test'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\` and then add 'jest' or 'mocha' to the types field in your tsconfig.",
        },
        {
          "code": 2593,
          "line": "my-test.test.ts:3:46",
          "message":
            "Cannot find name 'it'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\` and then add 'jest' or 'mocha' to the types field in your tsconfig.",
        },
        {
          "code": 2593,
          "line": "my-test.test.ts:4:52",
          "message":
            "Cannot find name 'describe'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\` and then add 'jest' or 'mocha' to the types field in your tsconfig.",
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
          "code": 2593,
          "line": "my-test.test.ts:7:54",
          "message":
            "Cannot find name 'beforeEach'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\` and then add 'jest' or 'mocha' to the types field in your tsconfig.",
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
        "GPUExternalTextureBindingLayout",
        "RTCAnswerOptions",
        "RTCOfferAnswerOptions",
        "RTCSetParameterOptions",
        "ReportBody",
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
          code: 2345,
          line: "serve-types.test.ts:520:33",
          message:
            "Argument of type 'HTMLBundle' is not assignable to parameter of type 'BodyInit | null | undefined'.",
        },
        {
          code: 2345,
          line: "serve-types.test.ts:522:45",
          message:
            "Argument of type 'HTMLBundle' is not assignable to parameter of type 'BodyInit | null | undefined'.",
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
