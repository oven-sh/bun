import fs from "fs";
import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("migrate from npm during `bun add`", async () => {
  fs.rmSync("bun.lockb", { recursive: true, force: true });
  fs.rmSync("node_modules", { recursive: true, force: true });
  fs.writeFileSync(
    "package.json",
    JSON.stringify({
      name: "test3",
      dependencies: {
        "lodash": "4.17.21",
        "svelte": "*",
      },
    }),
  );

  Bun.spawnSync([bunExe(), "add", "lodash@4.17.21"], {
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(fs.existsSync("node_modules/lodash")).toBeTrue();

  const svelte_version = JSON.parse(fs.readFileSync("node_modules/svelte/package.json", "utf8")).version;
  expect(svelte_version).toBe("4.0.0");

  const lodash_version = JSON.parse(fs.readFileSync("node_modules/lodash/package.json", "utf8")).version;
  expect(lodash_version).toBe("4.17.21");
});
