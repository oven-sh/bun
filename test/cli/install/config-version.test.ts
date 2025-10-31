import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { file } from "bun";
import { VerdaccioRegistry, runBunInstall, bunEnv as env } from "harness";
import { readlink } from "fs/promises";
import { join } from "path";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("configVersion", () => {
  test("new projects use current config version", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "new-proj",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(env, packageDir);

    expect(
      await file(join(packageDir, "node_modules/.bun/no-deps@1.0.0/node_modules/no-deps/package.json")).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });
});
