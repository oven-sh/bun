import { $, fileURLToPath, ShellError } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

const BUN_REPO_ROOT = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES_REPO_ROOT = join(BUN_REPO_ROOT, "packages", "bun-types");
const FIXTURE_DIR = fileURLToPath(import.meta.resolve("./fixture"));

let dir: string;

beforeAll(async () => {
  dir = fileURLToPath(import.meta.resolve("./fixture"));

  try {
    await $`
      cd ${dir}
      bun install
      cd ${BUN_TYPES_REPO_ROOT}
      bun install
      bun pm pack --destination ${FIXTURE_DIR}
      cd ${FIXTURE_DIR}
      bun add bun-types@bun-types-no-release.tgz
      rm bun-types-no-release.tgz
    `;
  } catch (e) {
    if (e instanceof ShellError) {
      console.log(e.stderr.toString());
    } else {
      console.error(e);
    }

    process.exit(1);
  }
});

afterAll(async () => {
  await $`
    cd ${dir}
    bun uninstall bun-types
  `;
});

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

describe("@types/bun integration test", () => {
  test("it typechecks successfully", async () => {
    const p = await $`
      cd ${dir}
      bun run check
    `;

    expect(p.exitCode).toBe(0);
  });
});
