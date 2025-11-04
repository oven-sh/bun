import { fileURLToPath, $ as Shell } from "bun";
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
let TEMP_FIXTURE_DIR: string;

beforeAll(async () => {
  TEMP_DIR = await mkdtemp(join(tmpdir(), "bun-types-test-"));
  TEMP_FIXTURE_DIR = join(TEMP_DIR, "fixture");

  try {
    await $`mkdir -p ${TEMP_FIXTURE_DIR}`;

    await cp(FIXTURE_SOURCE_DIR, TEMP_FIXTURE_DIR, { recursive: true });

    await $`
      cd ${BUN_TYPES_PACKAGE_ROOT}
      bun install --no-cache
      cp package.json package.json.backup
    `;

    const pkg = await Bun.file(BUN_TYPES_PACKAGE_JSON_PATH).json();

    await Bun.write(BUN_TYPES_PACKAGE_JSON_PATH, JSON.stringify({ ...pkg, version: BUN_VERSION }, null, 2));

    await $`
      cd ${BUN_TYPES_PACKAGE_ROOT}
      bun run build
      bun pm pack --destination ${TEMP_FIXTURE_DIR}
      rm CLAUDE.md
      mv package.json.backup package.json

      cd ${TEMP_FIXTURE_DIR}
      bun add bun-types@${BUN_TYPES_TARBALL_NAME}
      rm ${BUN_TYPES_TARBALL_NAME}
    `;

    const atTypesBunDir = join(TEMP_FIXTURE_DIR, "node_modules", "@types", "bun");
    console.log("Making tree", atTypesBunDir);

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

  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(program.getOptionsDiagnostics())
    .concat(program.getSyntacticDiagnostics())
    .concat(program.getConfigFileParsingDiagnostics())
    .concat(program.getDeclarationDiagnostics())
    .concat(program.emit().diagnostics)
    .map(diagnostic => ({
      line: getLine(diagnostic),
      message: typeof diagnostic.messageText === "string" ? diagnostic.messageText : diagnostic.messageText.messageText,
      code: diagnostic.code,
    }));

  return {
    diagnostics,
    emptyInterfaces: checkForEmptyInterfaces(program),
  };
}

const expectedEmptyInterfacesWhenNoDOM = new Set([
  "ThisType",
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
    console.log(TEMP_DIR);

    if (Bun.env.TYPES_INTEGRATION_TEST_KEEP_TEMP_DIR === "true") {
      console.log(`Keeping temp dir ${TEMP_DIR}/fixture for debugging`);
      await cp(TSCONFIG_SOURCE_PATH, join(TEMP_DIR, "fixture", "tsconfig.json"));
    } else {
      await rm(TEMP_DIR, { recursive: true, force: true });
    }
  }
});

describe("@types/bun integration test", () => {
  test("checks without lib.dom.d.ts", async () => {
    const { diagnostics, emptyInterfaces } = await diagnose(TEMP_FIXTURE_DIR);

    expect(emptyInterfaces).toEqual(expectedEmptyInterfacesWhenNoDOM);
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
      const jest_shouldBeDefined: object = jest;
      const vi_shouldBeDefined: object = vi;
    `;

    test("checks without lib.dom.d.ts and test-globals references", async () => {
      const { diagnostics, emptyInterfaces } = await diagnose(TEMP_FIXTURE_DIR, {
        files: {
          "reference-the-globals.ts": `/// <reference types="bun-types/test-globals" />`,
          "my-test.test.ts": code,
        },
      });

      expect(emptyInterfaces).toEqual(expectedEmptyInterfacesWhenNoDOM);
      expect(diagnostics).toEqual([]);
    });

    test("test-globals FAILS when the test-globals.d.ts is not referenced", async () => {
      const { diagnostics, emptyInterfaces } = await diagnose(TEMP_FIXTURE_DIR, {
        files: { "my-test.test.ts": code }, // no reference to bun-types/test-globals
      });

      expect(emptyInterfaces).toEqual(expectedEmptyInterfacesWhenNoDOM); // should still have no empty interfaces
      expect(diagnostics).toMatchInlineSnapshot(`
        [
          {
            "code": 2582,
            "line": "my-test.test.ts:2:48",
            "message": "Cannot find name 'test'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\`.",
          },
          {
            "code": 2582,
            "line": "my-test.test.ts:3:46",
            "message": "Cannot find name 'it'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\`.",
          },
          {
            "code": 2582,
            "line": "my-test.test.ts:4:52",
            "message": "Cannot find name 'describe'. Do you need to install type definitions for a test runner? Try \`npm i --save-dev @types/jest\` or \`npm i --save-dev @types/mocha\`.",
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
        ]
      `);
    });
  });

  test("checks with no lib at all", async () => {
    const { diagnostics, emptyInterfaces } = await diagnose(TEMP_FIXTURE_DIR, {
      options: {
        lib: [],
      },
    });

    expect(emptyInterfaces).toEqual(expectedEmptyInterfacesWhenNoDOM);
    expect(diagnostics).toEqual([]);
  });

  test("fails with types: [] and no jsx", async () => {
    const { diagnostics, emptyInterfaces } = await diagnose(TEMP_FIXTURE_DIR, {
      options: {
        lib: [],
        types: [],
        jsx: ts.JsxEmit.None,
      },
    });

    expect(emptyInterfaces).toEqual(expectedEmptyInterfacesWhenNoDOM);
    expect(diagnostics).toEqual([
      // This is expected because we, of course, can't check that our tsx file is passing
      // when tsx is turned off...
      {
        "code": 17004,
        "line": "[slug].tsx:17:10",
        "message": "Cannot use JSX unless the '--jsx' flag is provided.",
      },
    ]);
  });

  test("checks with lib.dom.d.ts", async () => {
    const { diagnostics, emptyInterfaces } = await diagnose(TEMP_FIXTURE_DIR, {
      options: {
        lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"].map(name => `lib.${name.toLowerCase()}.d.ts`),
      },
    });

    expect(emptyInterfaces).toEqual(
      new Set([
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
        "TrustedHTML",
      ]),
    );
    expect(diagnostics).toEqual([
      {
        code: 2769,
        line: "fetch.ts:25:32",
        message: "No overload matches this call.",
      },
      {
        code: 2769,
        line: "fetch.ts:33:32",
        message: "No overload matches this call.",
      },
      {
        code: 2769,
        line: "fetch.ts:168:34",
        message: "No overload matches this call.",
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
          "Argument of type 'AsyncGenerator<Uint8Array<ArrayBuffer> | \"it works!\", void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.",
      },
      {
        code: 2345,
        line: "index.ts:196:14",
        message:
          "Argument of type 'AsyncGenerator<Uint8Array<ArrayBuffer>, void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.",
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
        "code": 2769,
        "line": "streams.ts:18:3",
        "message": "No overload matches this call.",
      },
      {
        "code": 2339,
        "line": "streams.ts:20:16",
        "message": "Property 'write' does not exist on type 'ReadableByteStreamController'.",
      },
      {
        "code": 2339,
        "line": "streams.ts:46:19",
        "message": "Property 'json' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
      },
      {
        "code": 2339,
        "line": "streams.ts:47:19",
        "message": "Property 'bytes' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
      },
      {
        "code": 2339,
        "line": "streams.ts:48:19",
        "message": "Property 'text' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
      },
      {
        "code": 2339,
        "line": "streams.ts:49:19",
        "message": "Property 'blob' does not exist on type 'ReadableStream<Uint8Array<ArrayBufferLike>>'.",
      },
      {
        code: 2353,
        line: "websocket.ts:25:5",
        message: "Object literal may only specify known properties, and 'protocols' does not exist in type 'string[]'.",
      },
      {
        code: 2353,
        line: "websocket.ts:30:5",
        message: "Object literal may only specify known properties, and 'protocol' does not exist in type 'string[]'.",
      },
      {
        code: 2353,
        line: "websocket.ts:35:5",
        message: "Object literal may only specify known properties, and 'protocol' does not exist in type 'string[]'.",
      },
      {
        code: 2353,
        line: "websocket.ts:43:5",
        message: "Object literal may only specify known properties, and 'headers' does not exist in type 'string[]'.",
      },
      {
        code: 2353,
        line: "websocket.ts:51:5",
        message: "Object literal may only specify known properties, and 'protocols' does not exist in type 'string[]'.",
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
    ]);
  });
});
