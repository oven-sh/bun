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
      cp ${TSCONFIG_SOURCE_PATH} tsconfig.json
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
      # remove DOM from tsconfig.json
      sed -i '' 's/"lib": \["ESNext", "DOM"\]/"lib": \["ESNext"\]/' tsconfig.json
      bun run check
    `;

    expect(p.exitCode).toBe(0);
  });

  test("checks with default settings", async () => {
    const tsconfig = Bun.file(join(FIXTURE_DIR, "tsconfig.json"));
    await tsconfig.write((await tsconfig.text()).replace(/"lib": \["ESNext"\]/, '"lib": ["ESNext", "DOM"]'));

    const p = await $` 
      cd ${FIXTURE_DIR}
      bun run check
    `;

    const expectedOutput = [
      "index.ts(269,29): error TS2345: Argument of type '{ headers: { \"x-bun\": string; }; }' is not assignable to parameter of type 'number'.\n$ tsc --noEmit -p ./tsconfig.json\n",
    ].join("\n");

    expect(p.stdout.toString() + p.stderr.toString()).toEqual(expectedOutput);
    expect(p.exitCode).not.toBe(0);
  });
});
