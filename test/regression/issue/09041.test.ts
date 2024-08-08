import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";
import { $ } from "bun";
import { cp, rm } from "fs/promises";

test("09041", async () => {
  const out = tempDirWithFiles("09041", {
    "09041-fixture.mjs": await Bun.file(join(import.meta.dir, "09041", "09041-fixture.mjs")).text(),
    "09041-fixture.test.js": await Bun.file(join(import.meta.dir, "09041", "09041-fixture-test.txt")).text(),
    "package.json": `{}`,
  });

  let { exited, stderr, stdout } = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: out,
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  expect(await exited).toBe(0);
  const err = await new Response(stderr).text();
  expect(err).toContain("1 pass");
  expect(err).toContain("0 fail");
  const std = await new Response(stdout).text();

  expect(std.length).toBeGreaterThan(1024 * 1024);
}, 30000);
