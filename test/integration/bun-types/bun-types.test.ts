import { fileURLToPath, $ as Shell, ShellError } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

const BUN_REPO_ROOT = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES_PACKAGE_ROOT = join(BUN_REPO_ROOT, "packages", "bun-types");
const FIXTURE_DIR = fileURLToPath(import.meta.resolve("./fixture"));
const TSCONFIG_SOURCE_PATH = join(BUN_REPO_ROOT, "src/cli/init/tsconfig.default.json");
const BUN_TYPES_PACKAGE_JSON_PATH = join(BUN_TYPES_PACKAGE_ROOT, "package.json");
const BUN_VERSION = (process.env.BUN_VERSION || Bun.version || process.versions.bun).replace(/^.*v/, "");
const BUN_TYPES_TARBALL_NAME = `types-bun-${BUN_VERSION}.tgz`;
const $ = Shell.cwd(BUN_REPO_ROOT);

beforeAll(async () => {
  try {
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
      bun uninstall @types/bun
      bun add @types/bun@${BUN_TYPES_TARBALL_NAME}
      rm ${BUN_TYPES_TARBALL_NAME}
    `;
  } catch (e) {
    if (e instanceof ShellError) {
      console.log(e.stderr.toString());
    }

    throw e;
  }
});

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

describe("@types/bun integration test", () => {
  test("it typechecks successfully", async () => {
    const p = await $`
      cd ${FIXTURE_DIR}
      bun run check
    `;

    expect(p.exitCode).toBe(0);
  });
});
