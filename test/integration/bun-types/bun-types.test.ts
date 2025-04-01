import { fileURLToPath, $ as Shell } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUN_REPO_ROOT = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES_PACKAGE_ROOT = join(BUN_REPO_ROOT, "packages", "bun-types");
const FIXTURE_SOURCE_DIR = fileURLToPath(import.meta.resolve("./fixture"));
const TSCONFIG_SOURCE_PATH = join(BUN_REPO_ROOT, "src/cli/init/tsconfig.default.json");
const BUN_TYPES_PACKAGE_JSON_PATH = join(BUN_TYPES_PACKAGE_ROOT, "package.json");
const BUN_VERSION = (process.env.BUN_VERSION ?? Bun.version ?? process.versions.bun).replace(/^.*v/, "");
const BUN_TYPES_TARBALL_NAME = `types-bun-${BUN_VERSION}.tgz`;

const $ = Shell.cwd(BUN_REPO_ROOT).nothrow();

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

beforeEach(async () => {
  await $`
    cd ${FIXTURE_DIR}
    cp ${TSCONFIG_SOURCE_PATH} tsconfig.json
    sed -i 's/"skipLibCheck": true/"skipLibCheck": false/' tsconfig.json
    cat tsconfig.json
  `;
});

afterAll(async () => {
  if (TEMP_DIR) {
    await rm(TEMP_DIR, { recursive: true, force: true });
  }
});

describe("@types/bun integration test", () => {
  test("checks without lib.dom.d.ts", async () => {
    const p = await $`
      cd ${FIXTURE_DIR}
      bun run check
    `;

    expect(p.exitCode).toBe(0);
  });

  test("checks with lib.dom.d.ts", async () => {
    const tsconfig = Bun.file(join(FIXTURE_DIR, "tsconfig.json"));
    await tsconfig.write(
      (await tsconfig.text()).replace(
        /"lib": \["ESNext"\]/,
        '"lib": ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"]',
      ),
    );

    const p = await $` 
      cd ${FIXTURE_DIR}
      bun run check
    `;

    const importantLines = [
      `error TS2353: Object literal may only specify known properties, and 'headers' does not exist in type 'string[]'.`,
      `error TS2345: Argument of type 'AsyncGenerator<Uint8Array<ArrayBuffer>, void, unknown>' is not assignable to parameter of type 'BodyInit | null | undefined'.`,
      "error TS2769: No overload matches this call.",
      "Overload 1 of 3, '(underlyingSource: UnderlyingByteSource, strategy?: { highWaterMark?: number", // This line ends early because we've seen TypeScript emit differing messages in different environments
      "ReadableStream<Uint8Array<ArrayBufferLike>>', gave the following error.",
      `Type '"direct"' is not assignable to type '"bytes"'`,
      "error TS2345: Argument of type '{ headers: { \"x-bun\": string; }; }' is not assignable to parameter of type 'number'.",
      "error TS2339: Property 'write' does not exist on type 'ReadableByteStreamController'.",
      "error TS2339: Property 'ref' does not exist on type 'Worker'.",
      "error TS2339: Property 'unref' does not exist on type 'Worker'.",
      "error TS2339: Property 'threadId' does not exist on type 'Worker'.",
    ];

    const fullOutput = p.stdout.toString() + p.stderr.toString();

    const expectedErrorCount = importantLines.join("\n").match(/error/g)?.length ?? 0;
    const actualErrorCount = fullOutput.match(/error/g)?.length ?? 0;
    expect(actualErrorCount).toBe(expectedErrorCount);

    for (const line of importantLines) {
      expect(fullOutput).toContain(line);
    }

    expect(p.exitCode).toBe(2);
  });
});
