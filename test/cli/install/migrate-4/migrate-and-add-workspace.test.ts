import fs from "fs";
import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("migrate from npm during `bun add` workspace add", async () => {
  fs.rmSync("bun.lockb", { recursive: true, force: true });
  fs.rmSync("node_modules", { recursive: true, force: true });
  fs.cpSync(join(import.meta.dir, "packages/a/original.json"), join(import.meta.dir, "packages/a/package.json"));

  // Bun.spawnSync([bunExe(), "add", "svelte@3"], {
  //   env: bunEnv,
  //   cwd: join(import.meta.dir, "packages/a"),
  // });

  // const svelte_version = JSON.parse(fs.readFileSync("node_modules/svelte/package.json", "utf8")).version;
  // expect(svelte_version).toBe("3.0.0");
});
