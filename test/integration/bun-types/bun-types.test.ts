import { $, fileURLToPath, ShellError } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

const BUN_REPO_ROOT = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES_REPO_ROOT = join(BUN_REPO_ROOT, "packages", "bun-types");
const FIXTURE_DIR = fileURLToPath(import.meta.resolve("./fixture"));
const TSCONFIG_SOURCE_PATH = join(BUN_REPO_ROOT, "src/cli/init/tsconfig.default.json");

beforeAll(async () => {
  try {
    await $`
      cd ${BUN_TYPES_REPO_ROOT}
      bun install
      bun pm pack --destination ${FIXTURE_DIR}

      cd ${FIXTURE_DIR}
      cp ${TSCONFIG_SOURCE_PATH} tsconfig.json
      bun install
      bun add bun-types@bun-types-no-release.tgz
      rm bun-types-no-release.tgz
    `;
  } catch (e) {
    if (e instanceof ShellError) {
      console.log(e.stderr.toString());
    }

    throw e;
  }
});

afterAll(async () => {
  await $`
    cd ${FIXTURE_DIR}
    bun uninstall bun-types
    rm tsconfig.json
  `;
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
