import { $ as Shell, fileURLToPath } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, makeTree } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
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
// TEMP_DIR, so none of this may change in the checkout; the afterAll below checks that.
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
let BUN_TYPES_BUILD_DIR: string;

beforeAll(async () => {
  TEMP_DIR = await mkdtemp(join(tmpdir(), "bun-types-test-"));
  BASE_FIXTURE_DIR = join(TEMP_DIR, "base-fixture");
  BUN_TYPES_BUILD_DIR = join(TEMP_DIR, "bun-types");
  const bunTypesBuildDir = BUN_TYPES_BUILD_DIR;

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

/**
 * What the published types call the exports of each schema of the bindgen (docs/project/bindgen.mdx).
 * `null`: nothing, since JavaScript wraps them, they are not for users, or the file has only types.
 * `Class<T>`: the constructor of a class of which only the instances, `T`, are published.
 */
const PUBLISHED_AS: Record<string, string | null> = {
  "Archive.bind.ts": "typeof Bun",
  "Blob.bind.ts": "typeof Bun & { Blob: Class<Bun.BunFile> }",
  "BlockList.bind.ts": null,
  "BunObject.bind.ts":
    "typeof Bun & { braces: typeof Bun.$.braces; shellEscape: typeof Bun.$.escape; table: typeof Bun.inspect.table }",
  "BunObjectInternals.bind.ts": null,
  "BunTest.bind.ts": null,
  "ByteStream.bind.ts": null,
  "BytecodeOrderRecorder.bind.ts": null,
  "Counters.bind.ts": null,
  "Crypto.bind.ts":
    'typeof Bun & { Crypto: Class<Omit<Crypto, "subtle">>; timingSafeEqual: typeof import("node:crypto").timingSafeEqual }',
  "CryptoHasher.bind.ts": "typeof Bun",
  "DevServer.bind.ts": null,
  "FFIObject.bind.ts": null,
  "FakeTimers.bind.ts": 'typeof import("bun:test").jest',
  "FetchSession.bind.ts": "typeof Bun",
  "FetchTasklet.bind.ts": null,
  "FileSink.bind.ts": null,
  "FormData.bind.ts": null,
  "FrameworkRouter.bind.ts": null,
  "Glob.bind.ts": "typeof Bun",
  "HTMLBundle.bind.ts": null,
  "HashObject.bind.ts": "typeof Bun.hash & { wyhash: typeof Bun.hash }",
  "Image.bind.ts": "typeof Bun",
  "InternalSourceMap.bind.ts": null,
  "JSBundler.bind.ts": null,
  "JSMySQLConnection.bind.ts": null,
  "JSMySQLQuery.bind.ts": null,
  "JSON5Object.bind.ts": "typeof Bun.JSON5",
  "JSONCObject.bind.ts": "typeof Bun.JSONC",
  "Listener.bind.ts": null,
  "MarkdownObject.bind.ts": "typeof Bun.markdown",
  "MarkdownObjectInternals.bind.ts": null,
  "NodeHTTPResponse.bind.ts": null,
  "NodeModuleModule.bind.ts": null,
  "ObjectURLRegistry.bind.ts": null,
  "ParsedShellScript.bind.ts": null,
  "PasswordObject.bind.ts": "typeof Bun.password",
  "PostgresSQLConnection.bind.ts": null,
  "PostgresSQLQuery.bind.ts": null,
  "ReadableStream.bind.ts": null,
  "RequestContext.bind.ts": null,
  "ResourceUsage.bind.ts": null,
  "S3Client.bind.ts": "typeof Bun",
  "S3Stat.bind.ts": "{ S3Stat: Class<Bun.S3Stats> }",
  "S3UploadStream.bind.ts": null,
  "SSLConfig.bind.ts": null,
  "ScopeFunctions.bind.ts": null,
  "SecureContext.bind.ts": null,
  "SemverObject.bind.ts": "typeof Bun.semver",
  "SemverObjectInternals.bind.ts": null,
  "SocketAddress.bind.ts": null,
  "SocketConfig.bind.ts": null,
  "Stat.bind.ts": null,
  "TOMLObject.bind.ts": "typeof Bun.TOML",
  "Terminal.bind.ts": "typeof Bun",
  "TextDecoder.bind.ts": "{ TextDecoder: typeof TextDecoder }",
  "Timer.bind.ts": null,
  "Transpiler.bind.ts": "typeof Bun",
  "UnsafeObject.bind.ts": "typeof Bun.unsafe",
  "UpgradedDuplex.bind.ts": null,
  "XMLObject.bind.ts": "typeof Bun.XML",
  "YAMLObject.bind.ts": "typeof Bun.YAML",
  "bake_plugins.bind.ts": null,
  "bindgen_test.bind.ts": null,
  "bun_string_jsc.bind.ts": null,
  "cares_jsc.bind.ts": null,
  "color_js.bind.ts": "typeof Bun",
  "crash_handler_jsc.bind.ts": null,
  "cron.bind.ts": null,
  "csrf_jsc.bind.ts": "typeof Bun.CSRF",
  "css_internals.bind.ts": null,
  "dns.bind.ts": "typeof Bun.dns",
  "dns_internals.bind.ts": null,
  "error_jsc.bind.ts": null,
  "event_loop.bind.ts": null,
  "expect.bind.ts": null,
  "fetch.bind.ts":
    '{ fetch: typeof fetch; preconnect: typeof fetch.preconnect; sessionFetch: Bun.FetchSession["fetch"] }',
  "ffi.bind.ts": null,
  "filesystem_router.bind.ts":
    "typeof Bun & { FrameworkFileSystemRouter: Class<{ match(path: string): any; toJSON(): any }> }",
  "fmt_jsc.bind.ts": null,
  "h2_frame_parser.bind.ts": null,
  "headers_jsc.bind.ts": null,
  "hosted_git_info_jsc.bind.ts": null,
  "html_rewriter.bind.ts": "{ HTMLRewriter: typeof HTMLRewriter }",
  "html_rewriter_internals.bind.ts": null,
  "hw_exports.bind.ts": null,
  "imported_class_test.bind.ts": null,
  "ini_jsc.bind.ts": null,
  "install_binding.bind.ts": null,
  "interpreter.bind.ts": null,
  "ipc.bind.ts": null,
  "ipc_host.bind.ts": null,
  "jest.bind.ts": null,
  "js_bun_spawn_bindings.bind.ts": "typeof Bun",
  "jsc_hooks.bind.ts": null,
  "linear_fifo_testing.bind.ts": null,
  "memory_pressure.bind.ts": null,
  "mysql.bind.ts": null,
  "napi_body.bind.ts": null,
  "node_assert_binding.bind.ts": null,
  "node_cluster_binding.bind.ts": null,
  "node_crypto_binding.bind.ts": null,
  "node_fs_binding.bind.ts": null,
  "node_fs_stat_watcher.bind.ts": null,
  "node_fs_watcher.bind.ts": null,
  "node_http_binding.bind.ts": null,
  "node_net_binding.bind.ts": null,
  "node_os.bind.ts": null,
  "node_quic_binding.bind.ts": null,
  "node_tls_binding.bind.ts": null,
  "node_util_binding.bind.ts": null,
  "node_zlib_binding.bind.ts": null,
  "npm_jsc.bind.ts": null,
  "pack_command.bind.ts": null,
  "parse_args.bind.ts": null,
  "patch_testing.bind.ts": null,
  "postgres.bind.ts": null,
  "prompt.bind.ts": "{ alert: typeof alert; confirm: typeof confirm; prompt: typeof prompt }",
  "proxy_testing.bind.ts": null,
  "quic.bind.ts": null,
  "rare_data.bind.ts": null,
  "resolve_message.bind.ts": "{ ResolveMessage: Class<ResolveMessage>; BuildMessage: Class<BuildMessage> }",
  "resolver_jsc.bind.ts": null,
  "response.bind.ts":
    '{ Request: Class<Omit<Request, "keepalive" | "duplex">>; Response: typeof Response & { prototype: Response } }',
  "server.bind.ts": "{ ServerWebSocket: Class<Required<Bun.ServerWebSocket>> }",
  "server_body.bind.ts": null,
  "shell_body.bind.ts": null,
  "socket_body.bind.ts": null,
  "sourcemap.bind.ts": null,
  "subprocess.bind.ts": null,
  "udp_socket.bind.ts": null,
  "upgrade_command.bind.ts": null,
  "valkey.bind.ts": "typeof Bun",
  "virtual_machine_exports.bind.ts": null,
};

/**
 * Where the published types promise what the schema does not do: a call they allow has an argument
 * the schema refuses, a result they name is not one the schema gives, or an object has a member
 * that the schema's does not. They may be narrower than it, which says "a buffer" of a `Uint8Array`,
 * but not by leaving out `null` or `undefined`.
 */
function promisesTheSchemaBreaks(checker: ts.TypeChecker, published: ts.Type, schema: ts.Type) {
  const broken: string[] = [];
  const compared = new Map<ts.Type, Set<ts.Type>>();
  const show = (type: ts.Type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const generated = schema.symbol.declarations![0].getSourceFile();
  const isGenerated = (type: ts.Type) =>
    !!type.symbol?.declarations?.some(declaration => declaration.getSourceFile() === generated);
  const parts = (type: ts.Type) => (type.isUnion() ? type.types : [type]);
  /** `getPropertyOfType` does not find a member that a well-known symbol names. */
  const findMember = (type: ts.Type, member: ts.Symbol) =>
    checker.getPropertyOfType(type, member.name) ??
    checker.getPropertiesOfType(type).find(other => other.escapedName === member.escapedName);
  /** The compiler numbers a well-known symbol: `__@dispose@123`. */
  const nameOf = (member: ts.Symbol) => member.name.replace(/^__@(\w+)@\d+$/, "[Symbol.$1]");

  /** A dictionary or a class of the schema lists all it has, so nothing reads or gives any other member. */
  function membersTheSchemaLacks(published: ts.Type, schema: ts.Type) {
    const [listed, others] = [true, false].map(wanted =>
      parts(schema).filter(part => (isGenerated(part) && part.getCallSignatures().length === 0) === wanted),
    );
    if (listed.length === 0) return [];
    const names = parts(published)
      .filter(
        part => part.flags & ts.TypeFlags.Object && !others.some(other => checker.isTypeAssignableTo(part, other)),
      )
      .flatMap(part => part.getProperties())
      .filter(member => !listed.some(part => findMember(part, member)))
      .map(nameOf);
    return [...new Set(names)];
  }

  function refusal(allowed: ts.Signature, taken: ts.Signature) {
    for (const [i, parameter] of taken.parameters.entries()) {
      // `(...args: any[]) => any`, which is all that the schema says of a builtin.
      if ((parameter.valueDeclaration as ts.ParameterDeclaration).dotDotDotToken) break;
      const argument = allowed.parameters[i];
      const given = argument ? checker.getTypeOfSymbol(argument) : checker.getUndefinedType();
      const takes = checker.getTypeOfSymbol(parameter);
      if (!checker.isTypeAssignableTo(given, takes))
        return `${parameter.name} takes ${show(takes)}, not ${show(given)}`;
      const unread = membersTheSchemaLacks(given, takes);
      if (unread.length > 0) return `${parameter.name} has no ${unread.join(", ")}`;
    }
    return null;
  }

  function compareSignatures(path: string, allowed: readonly ts.Signature[], taken: readonly ts.Signature[]) {
    if (taken.length === 0) return;
    if (allowed.length === 0) broken.push(`${path} is not published as a function`);
    for (const signature of allowed) {
      const refusals = taken.map(candidate => refusal(signature, candidate));
      const match = taken[refusals.indexOf(null)];
      if (match) compare(`${path}()`, signature.getReturnType(), match.getReturnType());
      else broken.push(`${path}${checker.signatureToString(signature)}: ${refusals.join(", or ")}`);
    }
  }

  function compare(path: string, published: ts.Type, schema: ts.Type) {
    if (compared.get(published)?.has(schema)) return;
    compared.set(published, (compared.get(published) ?? new Set()).add(schema));
    // The exports of a file are a few of the members of `typeof Bun`.
    const never = path ? membersTheSchemaLacks(published, schema) : [];
    if (never.length > 0) broken.push(`${path} has no ${never.join(", ")}`);
    const calls = schema.getCallSignatures();
    const constructs = schema.getConstructSignatures();
    if (calls.length === 0 && constructs.length === 0 && !isGenerated(schema)) {
      const promisesNothing = published.flags & ts.TypeFlags.Void;
      const absent = parts(schema).filter(part => part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined));
      if (
        !promisesNothing &&
        (!checker.isTypeAssignableTo(published, schema) ||
          absent.some(part => !checker.isTypeAssignableTo(part, published)))
      ) {
        broken.push(`${path} is ${show(schema)}, not ${show(published)}`);
      }
      return;
    }
    compareSignatures(path, published.getCallSignatures(), calls);
    compareSignatures(`new ${path}`, published.getConstructSignatures(), constructs);
    for (const member of schema.getProperties()) {
      const promised = findMember(published, member);
      const memberPath = path ? `${path}.${nameOf(member)}` : nameOf(member);
      if (promised) compare(memberPath, checker.getTypeOfSymbol(promised), checker.getTypeOfSymbol(member));
      else broken.push(`${memberPath} is not published`);
    }
  }

  compare("", published, schema);
  return broken;
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

  // Checked here rather than in a test: when beforeAll throws or times out the tests are
  // skipped but afterAll still runs, and an interrupted beforeAll is exactly when building
  // in place used to leave its residue behind.
  expect(snapshotBunTypesCheckout()).toEqual(bunTypesCheckoutBeforeSetup);
});

describe("@types/bun integration test", () => {
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

  test.skipIf(isDebug)("promises nothing that a schema of the bindgen breaks", async () => {
    const dir = join(TEMP_DIR, "bindgen");
    const schemas = await Array.fromAsync(
      new Bun.Glob("src/**/*.bind.ts").scan({ cwd: BUN_REPO_ROOT, absolute: true }),
    );
    await $`${bunExe()} src/codegen/bindgen.ts --sources=${schemas.map(file => `bun=${file}`).join(",")} --codegen-path=${dir} --types-path=${dir}`
      .env(bunEnv)
      .quiet();
    const pairs = join(dir, "published.ts");
    await Bun.write(
      pairs,
      `export type Published = {\n${Object.entries(PUBLISHED_AS)
        .map(([file, type]) => `  ${JSON.stringify(file)}: ${type};\n`)
        .join("")}};\nexport type Schemas = $Bindgen.Exports;\ntype Class<T> = { new (): T; prototype: T };\n`,
    );
    const program = ts.createProgram({
      rootNames: [join(BASE_FIXTURE_DIR, "node_modules", "bun-types", "index.d.ts"), join(dir, "Bindgen.d.ts"), pairs],
      options: { ...DEFAULT_COMPILER_OPTIONS, types: [], skipLibCheck: false },
    });
    const source = program.getSourceFile(pairs)!;
    // A name that does not resolve is a type that everything is assignable to.
    for (const file of [source, program.getSourceFile(join(dir, "Bindgen.d.ts"))!]) {
      expect(ts.getPreEmitDiagnostics(program, file).map(diagnostic => diagnostic.messageText)).toEqual([]);
    }

    const checker = program.getTypeChecker();
    const [published, generated] = source.statements.map(statement => checker.getTypeAtLocation(statement));
    expect(schemas.map(file => basename(file)).sort()).toEqual(Object.keys(PUBLISHED_AS).sort());
    expect(
      Object.keys(PUBLISHED_AS)
        .filter(file => PUBLISHED_AS[file])
        .flatMap(file =>
          promisesTheSchemaBreaks(
            checker,
            checker.getTypeOfSymbol(published.getProperty(file)!),
            checker.getTypeOfSymbol(generated.getProperty(file)!),
          ).map(promise => `${file}: ${promise}`),
        ),
    ).toEqual([
      // Published, and nothing has ever read it.
      "Transpiler.bind.ts: new Transpiler(options?: TranspilerOptions | undefined): Transpiler: options has no jsxOptimizationInline",
      // `keepalive` and `duplex` are declared on Request but not implemented.
      "filesystem_router.bind.ts: new FileSystemRouter().match(input: string | Request | Response): MatchedRoute | null: input has no keepalive, duplex",
      // globals.d.ts does not declare these.
      "resolve_message.bind.ts: new BuildMessage().toJSON is not published",
      "resolve_message.bind.ts: new BuildMessage().column is not published",
      "resolve_message.bind.ts: new BuildMessage().line is not published",
      "resolve_message.bind.ts: new BuildMessage().notes is not published",
      "resolve_message.bind.ts: new BuildMessage().[Symbol.toPrimitive] is not published",
      "resolve_message.bind.ts: new ResolveMessage().toJSON is not published",
      "resolve_message.bind.ts: new ResolveMessage().column is not published",
      "resolve_message.bind.ts: new ResolveMessage().line is not published",
      "resolve_message.bind.ts: new ResolveMessage().requireStack is not published",
      "resolve_message.bind.ts: new ResolveMessage().stack is not published",
      "resolve_message.bind.ts: new ResolveMessage().[Symbol.toPrimitive] is not published",
      // `pendingDeclarations` in test/internal/source-lints/redis-client-types.test.ts.
      "valkey.bind.ts: new RedisClient().psubscribe is not published",
      "valkey.bind.ts: new RedisClient().pubsub is not published",
      "valkey.bind.ts: new RedisClient().punsubscribe is not published",
      "valkey.bind.ts: new RedisClient().select is not published",
    ]);
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

  // Runs on debug builds too: one install plus tsc over a single file.
  // With the isolated linker and the global store, bun-types lives under
  // <cache>/links/ and its imports resolve only through the dependencies it
  // declares. The hoisted fallback layer of the project is not on that path,
  // so `import("undici-types")` in bun.d.ts, fetch.d.ts and globals.d.ts
  // fails unless package.json declares undici-types (#43666).
  describe("isolated install with the global store", () => {
    test("bun-types resolves undici-types through its own dependencies", async () => {
      const checkDir = join(TEMP_DIR, "global-store-check");
      const cacheDir = join(checkDir, ".bun-cache");
      const tsconfig = structuredClone(sourceTsconfig);
      tsconfig.include = ["index.ts"];
      tsconfig.compilerOptions.types = ["bun-types"];
      tsconfig.compilerOptions.skipLibCheck = false;
      await mkdir(checkDir, { recursive: true });
      await $`cd ${BUN_TYPES_BUILD_DIR} && bun pm pack --destination ${checkDir}`.quiet();
      await makeTree(checkDir, {
        "package.json": JSON.stringify({
          name: "global-store-check",
          private: true,
          devDependencies: {
            "bun-types": `./${BUN_TYPES_TARBALL_NAME}`,
            "@types/node": "latest",
          },
        }),
        "bunfig.toml": `[install]\nlinker = "isolated"\nglobalStore = true\ncache = ${JSON.stringify(cacheDir)}\n`,
        "tsconfig.json": JSON.stringify(tsconfig, null, 2),
        "index.ts": `const headers: Headers = new Headers({ "content-type": "text/plain" });
           const response: Response = await fetch("https://example.com", { headers, proxy: "http://proxy" });
           console.log(response.status, Bun.version);`,
      });

      // CI exports BUN_INSTALL_CACHE_DIR, which overrides bunfig's `cache`.
      // Pin it so the store links land under checkDir. BUN_INSTALL_GLOBAL_STORE
      // overrides bunfig's `globalStore` the same way.
      const installEnv = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir, BUN_INSTALL_GLOBAL_STORE: "1" };
      await using install = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: installEnv,
        cwd: checkDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [installStdout, installStderr, installExitCode] = await Promise.all([
        install.stdout.text(),
        install.stderr.text(),
        install.exited,
      ]);
      expect(installStderr + installStdout).not.toContain("error");
      expect(installExitCode).toBe(0);

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

      // The project links into the store, so bun-types is not under checkDir.
      // tmpdir() can contain a symlink (/var on macOS), so both sides are real paths.
      const bunTypesRealDir = await realpath(join(checkDir, "node_modules", "bun-types"));
      expect(bunTypesRealDir).toStartWith(await realpath(join(cacheDir, "links")));
      expect(existsSync(join(dirname(bunTypesRealDir), "undici-types", "package.json"))).toBe(true);
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

  describe("SQLite options", () => {
    typeTest("accept a value that is not set with exactOptionalPropertyTypes", {
      options: { exactOptionalPropertyTypes: true },
      files: {
        "sqlite-options.ts": `
          import { SQL } from "bun";
          import { Database, type DatabaseOptions } from "bun:sqlite";

          declare const settings: {
            readonly?: boolean;
            create?: boolean;
            readwrite?: boolean;
            safeIntegers?: boolean;
            strict?: boolean;
            deterministic?: boolean;
          };
          declare const bytes: Uint8Array;
          const db = new Database(":memory:", {
            readonly: settings.readonly,
            create: settings.create,
            readwrite: settings.readwrite,
            safeIntegers: settings.safeIntegers,
            strict: settings.strict,
          });
          Database.deserialize(bytes, { readonly: settings.readonly, safeIntegers: settings.safeIntegers });
          db.function("f", { deterministic: settings.deterministic, safeIntegers: settings.safeIntegers }, () => 1);
          db.aggregate("g", { step: () => 1, inverse: undefined, deterministic: settings.deterministic });

          // Bun.SQL passes its options on to bun:sqlite.
          declare const databaseOptions: DatabaseOptions;
          const sqlOptions: SQL.SQLiteOptions = databaseOptions;
          new Database(":memory:", sqlOptions);
          Database.deserialize(bytes, databaseOptions);
        `,
      },
      emptyInterfaces: expectedEmptyInterfacesWhenNoDOM,
      diagnostics: diagnostics => {
        expect(diagnostics.filter(d => d.line?.startsWith("sqlite-options.ts"))).toEqual([]);
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
        // lib.dom's Blob has no textStream(); node:buffer's Blob declares it
        // since @types/node 26.5.0 (added to Node.js in v24.19.0 / v26.5.0).
        {
          code: 2741,
          line: "24154.ts:11:3",
          message:
            "Property 'textStream' is missing in type 'Blob' but required in type 'import(\"node:buffer\").Blob'.",
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
          code: 2551,
          line: "websocket.ts:206:17",
          message: "Property 'URL' does not exist on type 'WebSocket'. Did you mean 'url'?",
        },
        {
          code: 2322,
          line: "websocket.ts:210:3",
          message: "Type '\"nodebuffer\"' is not assignable to type 'BinaryType'.",
        },
        {
          code: 2339,
          line: "websocket.ts:256:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:259:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:263:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:267:6",
          message: "Property 'ping' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:270:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:273:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:277:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:281:6",
          message: "Property 'pong' does not exist on type 'WebSocket'.",
        },
        {
          code: 2339,
          line: "websocket.ts:284:6",
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
